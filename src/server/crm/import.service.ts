import {
  CURRENCIES,
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
  REQUIRED_COLUMNS,
  contactCreateSchema,
  type CustomFieldValues,
  type ImportEntity,
  type ImportIssue,
  type ImportJobDetailDto,
  type ImportJobDto,
  type ImportOptions,
  type ImportPreviewDto,
  type ImportSummary,
  type IssueCode,
  type LifecycleStage,
  type Permission,
} from "@/shared";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../billing/entitlements.service";
import { authedContext, currentContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { readSheet, TabularError } from "../common/tabular";
import type { Database, Tx } from "../db/database";
import type { Contact, Deal, FieldDefinition, ImportJob } from "../db/models";
import { and } from "../db/query";
import { createId, type Insert } from "../db/repo";
import type { UploadedFile } from "../tasks/files.service";
import { LIFECYCLE_LOOKUP, SOURCE_LOOKUP, currencyCode, headerKeys, norm, parseBool, parseDate, parseNumber, splitList } from "./data-files";
import { memberRefs, ownerScope, type OwnerScope } from "./scope";
import { applyCustomFields, contactEntity, toBaseAmount } from "./settings.service";

/** Issues kept with a finished import (and rows echoed back in the issues file) */
const MAX_STORED_ISSUES = 1000;
/** Issues shown in a preview */
const PREVIEW_ISSUES = 50;
const INSERT_CHUNK = 500;
const POSITION_STEP = 1000;

const cut = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);

/** Custom-field validation messages (settings.service) → issue codes */
const CF_CODES: Record<string, IssueCode> = {
  Required: "required",
  "Number expected": "invalid_number",
  "Amount expected": "invalid_number",
  "Date expected": "invalid_date",
  "Unknown option": "unknown_option",
  "Yes/no expected": "invalid_value",
};

interface Sheet {
  fileName: string;
  headers: string[];
  data: string[][];
}

/** One row's problems; `ok` is false once any of them is an error. */
class RowIssues {
  readonly list: ImportIssue[] = [];
  constructor(readonly row: number) {}
  add(field: string | undefined, code: IssueCode, value?: string) {
    this.list.push({ row: this.row, ...(field ? { field } : {}), code, ...(value ? { value: cut(value) } : {}) });
  }
  get ok() {
    return this.list.length === 0;
  }
}

interface Outcome {
  summary: ImportSummary;
  issues: ImportIssue[];
  /** File lines with issues (for echoing the original cells back) */
  issueLines: Set<number>;
  createdIds: string[];
}

/** Per-request lookups shared by every row */
interface Lookups {
  ctx: AuthedContext;
  scope: OwnerScope;
  defs: Map<string, FieldDefinition>;
  /** Normalised member email / full name → membership id (null: ambiguous name) */
  members: Map<string, string | null>;
}

/**
 * CSV/XLSX import of people, companies and deals: the file is read and checked row by
 * row (preview), then written in one transaction (all rows or none). Nothing is stored
 * between preview and import — the browser sends the file again — so no half-finished
 * uploads linger. Imports don't fire automations or write per-record timeline entries:
 * a thousand "contact created" events would flood both.
 */
export class ImportService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async preview(file: UploadedFile | undefined, options: ImportOptions): Promise<ImportPreviewDto> {
    const sheet = this.read(file);
    const ctx = authedContext();
    this.checkAccess(options);
    return this.db.scoped(async (tx) => {
      const lookups = await this.lookups(tx, ctx, options.entity);
      const mapping = this.mapping(sheet, options, lookups.defs);
      const missing = this.missing(options.entity, mapping);
      const outcome = missing.length ? null : await this.process(tx, lookups, sheet, mapping, options, false);
      return {
        fileName: sheet.fileName,
        headers: sheet.headers,
        sample: sheet.data.slice(0, 3),
        mapping,
        rows: sheet.data.length,
        missing,
        summary: outcome?.summary ?? { create: 0, update: 0, skip: 0, failed: 0, companies: 0 },
        issues: outcome?.issues.slice(0, PREVIEW_ISSUES) ?? [],
        issueCount: outcome?.issues.length ?? 0,
      };
    });
  }

  async run(file: UploadedFile | undefined, options: ImportOptions): Promise<ImportJobDetailDto> {
    const sheet = this.read(file);
    const ctx = authedContext();
    this.checkAccess(options);
    return this.db.scoped(async (tx) => {
      const lookups = await this.lookups(tx, ctx, options.entity);
      const mapping = this.mapping(sheet, options, lookups.defs);
      const missing = this.missing(options.entity, mapping);
      if (missing.length) throw new AppError("VALIDATION_FAILED", "Required columns are not mapped", { mapping: missing });
      const outcome = await this.process(tx, lookups, sheet, mapping, options, true);
      const job = await tx.importJob.insertOne({
        tenantId: ctx.tenantId,
        entity: options.entity,
        fileName: sheet.fileName,
        duplicates: options.duplicates,
        rows: sheet.data.length,
        headers: sheet.headers,
        mapping,
        summary: outcome.summary,
        issues: outcome.issues.slice(0, MAX_STORED_ISSUES) as unknown as ImportJob["issues"],
        issueRows: [...outcome.issueLines].slice(0, MAX_STORED_ISSUES).map((row) => ({ row, cells: sheet.data[row - 2] ?? [] })) as unknown as ImportJob["issueRows"],
        createdIds: outcome.createdIds,
        byId: ctx.membershipId,
      });
      await this.audit.log(tx, { action: "import.completed", entityType: "import", entityId: job.id, diff: { entity: options.entity, file: sheet.fileName, rows: sheet.data.length, ...outcome.summary } });
      return this.toDetail(job, await memberRefs(tx, ctx.tenantId, [job.byId]));
    });
  }

  async history(): Promise<ImportJobDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const rows = await tx.importJob.find({ tenantId: ctx.tenantId }, { sort: { createdAt: -1 }, limit: 30, projection: { issues: 0, issueRows: 0, createdIds: 0 } });
      const refs = await memberRefs(tx, ctx.tenantId, rows.map((r) => r.byId));
      return rows.map((r) => this.toDto(r, refs));
    });
  }

  async get(id: string): Promise<ImportJobDetailDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const job = await tx.importJob.findOne({ id, tenantId: ctx.tenantId });
      if (!job) throw notFound("Import");
      return this.toDetail(job, await memberRefs(tx, ctx.tenantId, [job.byId]));
    });
  }

  // ─── Reading and mapping ────────────────────────────────────

  private read(file: UploadedFile | undefined): Sheet {
    if (!file) throw new AppError("VALIDATION_FAILED", "A file is required", { file: ["required"] });
    if (file.size > IMPORT_LIMITS.fileMb * 1024 * 1024) throw new AppError("FILE_TOO_LARGE", "File too large", { file: ["too_large"] });
    let rows: string[][];
    try {
      rows = readSheet(file.buffer, file.originalname);
    } catch (e) {
      if (e instanceof TabularError) throw new AppError("VALIDATION_FAILED", "Unreadable file", { file: [e.reason] });
      throw e;
    }
    const [headerRow, ...data] = rows;
    if (!data.length) throw new AppError("VALIDATION_FAILED", "No data rows", { file: ["empty"] });
    if (data.length > IMPORT_LIMITS.rows) throw new AppError("VALIDATION_FAILED", "Too many rows", { file: ["too_many_rows"] });
    const width = Math.max(...rows.map((r) => r.length));
    if (width > IMPORT_LIMITS.columns) throw new AppError("VALIDATION_FAILED", "Too many columns", { file: ["too_many_columns"] });
    const headers = Array.from({ length: width }, (_, i) => headerRow![i] ?? "");
    return { fileName: file.originalname.slice(0, 200), headers, data: data.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")) };
  }

  /** The caller's mapping (checked), or one suggested from the headers. */
  private mapping(sheet: Sheet, options: ImportOptions, defs: Map<string, FieldDefinition>): string[] {
    const keys: readonly string[] = IMPORT_COLUMNS[options.entity];
    if (options.mapping) {
      const mapping = sheet.headers.map((_, i) => options.mapping![i] ?? "");
      const used = mapping.filter(Boolean);
      const bad = used.filter((k) => !keys.includes(k) && !(k.startsWith("cf.") && defs.has(k.slice(3))));
      if (bad.length || new Set(used).size !== used.length) throw new AppError("VALIDATION_FAILED", "Invalid column mapping", { mapping: bad.length ? bad : ["duplicate"] });
      return mapping;
    }
    const byHeader = headerKeys(options.entity, keys);
    const byLabel = new Map([...defs.values()].map((d) => [norm(d.label), `cf.${d.id}`]));
    const taken = new Set<string>();
    return sheet.headers.map((h) => {
      const key = byHeader.get(norm(h)) ?? byLabel.get(norm(h));
      if (!key || taken.has(key)) return "";
      taken.add(key);
      return key;
    });
  }

  private missing(entity: ImportEntity, mapping: string[]) {
    return mapping.includes(REQUIRED_COLUMNS[entity]) ? [] : [REQUIRED_COLUMNS[entity]];
  }

  /** Importing creates (and in update mode changes) records: the same rights as doing it by hand. */
  private checkAccess({ entity, duplicates }: ImportOptions) {
    const ctx = currentContext();
    if (entity === "deal" && !ctx.features?.includes("deals.pipeline")) {
      throw new AppError("FEATURE_NOT_IN_PLAN", "Deals are not in the plan", { feature: "deals.pipeline" });
    }
    const needed: Permission[] = entity === "deal" ? ["deals.create"] : ["contacts.create", ...(duplicates === "update" ? (["contacts.edit"] as const) : [])];
    const lacking = needed.find((p) => !ctx.permissions?.includes(p));
    if (lacking) throw forbidden(`Requires permission ${lacking}`);
  }

  private async lookups(tx: Tx, ctx: AuthedContext, entity: ImportEntity): Promise<Lookups> {
    const fieldEntity = entity === "deal" ? "deal" : contactEntity(entity);
    const [scope, defs, memberships] = await Promise.all([
      ownerScope(tx, ctx, "contacts.view_all"),
      tx.fieldDefinition.find({ tenantId: ctx.tenantId, entity: fieldEntity, archived: false }),
      tx.membership.find({ tenantId: ctx.tenantId, status: "ACTIVE" }, { projection: { id: 1, userId: 1 } }),
    ]);
    const users = await tx.user.find({ id: { $in: memberships.map((m) => m.userId) } }, { projection: { id: 1, email: 1, fullName: 1 } });
    const byUser = new Map(users.map((u) => [u.id, u]));
    const members = new Map<string, string | null>();
    for (const m of memberships) {
      const u = byUser.get(m.userId);
      if (!u) continue;
      members.set(norm(u.email), m.id);
      const name = norm(u.fullName);
      members.set(name, members.has(name) && members.get(name) !== m.id ? null : m.id);
    }
    return { ctx, scope, defs: new Map(defs.map((d) => [d.id, d])), members };
  }

  private process(tx: Tx, lookups: Lookups, sheet: Sheet, mapping: string[], options: ImportOptions, write: boolean): Promise<Outcome> {
    return options.entity === "deal" ? this.deals(tx, lookups, sheet, mapping, write) : this.contacts(tx, lookups, sheet, mapping, options, write);
  }

  // ─── Shared cell readers ────────────────────────────────────

  /** Cells of one row by target column ("" = not mapped or empty). */
  private cells(row: string[], mapping: string[]) {
    const out = new Map<string, string>();
    mapping.forEach((key, i) => key && out.set(key, row[i] ?? ""));
    return out;
  }

  private owner(raw: string | undefined, lookups: Lookups, issues: RowIssues): string | undefined {
    // Without contacts.manage records are kept by the importer, like a manual create
    if (!raw || !lookups.ctx.permissions.includes("contacts.manage")) return undefined;
    const id = lookups.members.get(norm(raw));
    if (!id) issues.add("owner", "unknown_owner", raw);
    return id ?? undefined;
  }

  /** Custom field cells → typed values (then checked by applyCustomFields). */
  private customValues(cells: Map<string, string>, lookups: Lookups, issues: RowIssues): CustomFieldValues {
    const out: CustomFieldValues = {};
    for (const [key, raw] of cells) {
      if (!key.startsWith("cf.") || !raw) continue;
      const def = lookups.defs.get(key.slice(3))!;
      switch (def.type) {
        case "number":
        case "currency": {
          const n = parseNumber(raw);
          if (Number.isNaN(n) || (def.type === "currency" && n < 0)) issues.add(key, "invalid_number", raw);
          else out[def.id] = def.type === "currency" ? Math.round(n * 100) : n;
          break;
        }
        case "date": {
          const d = parseDate(raw);
          if (!d) issues.add(key, "invalid_date", raw);
          else out[def.id] = d;
          break;
        }
        case "checkbox": {
          const b = parseBool(raw);
          if (b === null) issues.add(key, "invalid_value", raw);
          else out[def.id] = b;
          break;
        }
        case "select": {
          const option = def.options.find((o) => norm(o) === norm(raw));
          if (!option) issues.add(key, "unknown_option", raw);
          else out[def.id] = option;
          break;
        }
        case "multiselect": {
          const values = splitList(raw);
          const options = values.map((v) => def.options.find((o) => norm(o) === norm(v)));
          const unknown = values.filter((_, i) => !options[i]);
          if (unknown.length) issues.add(key, "unknown_option", unknown.join(", "));
          else out[def.id] = options as string[];
          break;
        }
        default:
          out[def.id] = raw.slice(0, 1000);
      }
    }
    return out;
  }

  /** applyCustomFields with its error turned into a row issue; undefined on failure. */
  private applyFields(lookups: Lookups, values: CustomFieldValues, current: Record<string, unknown> | null, issues: RowIssues) {
    try {
      return applyCustomFields([...lookups.defs.values()], values, current);
    } catch (e) {
      if (!(e instanceof AppError) || !e.details) throw e;
      for (const [key, messages] of Object.entries(e.details as Record<string, string[]>)) {
        issues.add(key, CF_CODES[messages[0] ?? ""] ?? "invalid_value", key.startsWith("cf.") ? String(values[key.slice(3)] ?? "") : undefined);
      }
      return undefined;
    }
  }

  // ─── People and companies ───────────────────────────────────

  private async contacts(tx: Tx, lookups: Lookups, sheet: Sheet, mapping: string[], options: ImportOptions, write: boolean): Promise<Outcome> {
    const { ctx } = lookups;
    const entity = options.entity as "person" | "company";
    const isCompany = entity === "company";
    const summary: ImportSummary = { create: 0, update: 0, skip: 0, failed: 0, companies: 0 };
    const issues: ImportIssue[] = [];
    const issueLines = new Set<number>();
    const schema = contactCreateSchema.shape;

    // Existing records that rows may match: same type, by email / phone (companies also by name)
    const rows = sheet.data.map((r) => this.cells(r, mapping));
    const emails = rows.map((c) => schema.email.safeParse(c.get("email") ?? "").data).filter((v): v is string => !!v);
    const phones = rows.map((c) => schema.phone.safeParse(c.get("phone") ?? "").data).filter((v): v is string => !!v);
    const typeFilter = isCompany ? { type: "company" } : { type: { $ne: "company" } };
    const candidates = await tx.contact.find(
      { tenantId: ctx.tenantId, deletedAt: null, ...typeFilter, $or: [{ email: { $in: emails } }, { phone: { $in: phones } }] },
      { projection: { id: 1, name: 1, email: 1, phone: 1, ownerId: 1, tags: 1, customFields: 1, type: 1 } },
    );
    // Companies by name: for company rows (duplicates) and people's company column (links)
    const companies =
      isCompany || mapping.includes("company")
        ? await tx.contact.find({ tenantId: ctx.tenantId, deletedAt: null, type: "company" }, { projection: { id: 1, name: 1, email: 1, phone: 1, ownerId: 1, tags: 1, customFields: 1, type: 1 } })
        : [];
    const byEmail = new Map(candidates.filter((c) => c.email).map((c) => [c.email!, c]));
    const byPhone = new Map(candidates.filter((c) => c.phone).map((c) => [c.phone!, c]));
    const companyByName = new Map(companies.map((c) => [norm(c.name), c]));
    const byName = isCompany ? companyByName : new Map<string, (typeof companies)[number]>();

    // People's companies not in the database: created once each, unless companies have required fields
    const companyFieldsRequired = !isCompany && options.createCompanies && (await tx.fieldDefinition.count({ tenantId: ctx.tenantId, entity: "company", archived: false, required: true })) > 0;
    const newCompanies = new Map<string, { id: string; name: string; ownerId: string | null }>();

    const seen = new Map<string, number>();
    const inserts: Insert<Contact>[] = [];
    const updates: { id: string; set: Partial<Contact> }[] = [];

    rows.forEach((cells, index) => {
      const line = index + 2;
      const rowIssues = new RowIssues(line);
      const get = (k: string) => cells.get(k) || undefined;

      const name = get("name");
      if (name && name.length > 150) rowIssues.add("name", "too_long", name);
      const email = this.parse(schema.email, get("email"), "email", "invalid_email", rowIssues);
      const phone = this.parse(schema.phone, get("phone"), "phone", "invalid_phone", rowIssues);
      let stage: LifecycleStage | undefined;
      if (get("stage")) {
        stage = LIFECYCLE_LOOKUP.get(norm(get("stage")!));
        if (!stage) rowIssues.add("stage", "unknown_stage", get("stage"));
      }
      let source: string | undefined;
      if (get("source")) {
        source = SOURCE_LOOKUP.get(norm(get("source")!));
        if (!source) rowIssues.add("source", "invalid_value", get("source"));
      }
      const tags = get("tags") ? splitList(get("tags")!) : undefined;
      if (tags && (tags.length > 20 || tags.some((t) => t.length > 40))) rowIssues.add("tags", "too_long", get("tags"));
      const ownerId = this.owner(get("owner"), lookups, rowIssues);
      const companyName = isCompany ? undefined : get("company")?.slice(0, 150);
      const values = this.customValues(cells, lookups, rowIssues);

      // Duplicates: of a record in the database, or of an earlier row of this file
      const keys = [email && `e:${email}`, phone && `p:${phone}`, isCompany && name && `n:${norm(name)}`].filter((k): k is string => !!k);
      const match = (email && byEmail.get(email)) || (phone && byPhone.get(phone)) || (isCompany && name && byName.get(norm(name))) || null;
      if (options.duplicates !== "create") {
        const earlier = keys.map((k) => seen.get(k)).find((l) => l !== undefined);
        if (earlier !== undefined) return skip("duplicate_in_file", String(earlier));
        if (match && options.duplicates === "skip") return skip("duplicate", match.name);
      }

      function skip(code: IssueCode, value: string) {
        summary.skip++;
        issues.push({ row: line, code, value: cut(value), skipped: true });
        issueLines.add(line);
      }

      const update = match && options.duplicates === "update" ? match : null;
      if (update && !this.visible(update.ownerId, lookups.scope)) rowIssues.add(undefined, "not_visible", update.name);
      if (!update && !name) rowIssues.add("name", "required");
      const customFields = rowIssues.ok
        ? this.applyFields(lookups, values, update ? ((update.customFields ?? {}) as Record<string, unknown>) : null, rowIssues)
        : undefined;
      if (!rowIssues.ok) {
        summary.failed++;
        issues.push(...rowIssues.list);
        issueLines.add(line);
        return;
      }
      for (const k of keys) seen.set(k, line);

      // People's company: an existing company, one created by this import, or plain text
      let company: { companyId: string | null; companyName: string | null } | undefined;
      if (companyName) {
        const key = norm(companyName);
        const found = companyByName.get(key) ?? newCompanies.get(key);
        if (found) company = { companyId: found.id, companyName: found.name };
        else if (options.createCompanies && !companyFieldsRequired) {
          const created = { id: createId(), name: companyName, ownerId: ownerId ?? ctx.membershipId };
          newCompanies.set(key, created);
          company = { companyId: created.id, companyName };
        } else company = { companyId: null, companyName };
      }

      if (update) {
        summary.update++;
        // Only the file's non-empty cells change the record; tags are added to the existing ones
        const set: Partial<Contact> = {
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(stage ? { stage } : {}),
          ...(source ? { source } : {}),
          ...(ownerId ? { ownerId } : {}),
          ...(company ?? {}),
          ...(tags ? { tags: [...new Set([...update.tags, ...tags])].slice(0, 20) } : {}),
          ...(Object.keys(values).length ? { customFields: customFields as Contact["customFields"] } : {}),
        };
        if (Object.keys(set).length) updates.push({ id: update.id, set });
        return;
      }
      summary.create++;
      inserts.push({
        id: createId(),
        tenantId: ctx.tenantId,
        type: entity,
        name: name!,
        email: email ?? null,
        phone: phone ?? null,
        companyName: company?.companyName ?? null,
        companyId: company?.companyId ?? null,
        stage: stage ?? "LEAD",
        source: source ?? "manual",
        tags: tags ?? [],
        customFields: (customFields ?? {}) as Contact["customFields"],
        ownerId: ownerId ?? ctx.membershipId,
      });
    });
    summary.companies = newCompanies.size;

    const createdIds: string[] = [];
    if (write) {
      const companyDocs: Insert<Contact>[] = [...newCompanies.values()].map((c) => ({ id: c.id, tenantId: ctx.tenantId, type: "company", name: c.name, source: "manual", ownerId: c.ownerId }));
      await this.entitlements.assertCapacity(tx, ctx.tenantId, "contacts", companyDocs.length + inserts.length);
      for (const docs of [companyDocs, inserts]) {
        for (let i = 0; i < docs.length; i += INSERT_CHUNK) createdIds.push(...(await tx.contact.insertMany(docs.slice(i, i + INSERT_CHUNK))).map((c) => c.id));
      }
      for (const u of updates) await tx.contact.update({ id: u.id, tenantId: ctx.tenantId }, { $set: u.set });
      // A renamed company's people show the new name
      if (isCompany) for (const u of updates) if (u.set.name) await tx.contact.updateMany({ tenantId: ctx.tenantId, companyId: u.id }, { $set: { companyName: u.set.name } });
    }
    return { summary, issues, issueLines, createdIds };
  }

  private parse<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, raw: string | undefined, field: string, code: IssueCode, issues: RowIssues): NonNullable<T> | undefined {
    if (!raw) return undefined;
    const res = schema.safeParse(raw);
    if (!res.success) issues.add(field, code, raw);
    return (res.data ?? undefined) as NonNullable<T> | undefined;
  }

  /** Whether the importer may change a record owned by `ownerId` (the contact list's visibility). */
  private visible(ownerId: string | null, scope: OwnerScope) {
    if (!scope.memberIds) return true;
    return ownerId ? scope.memberIds.includes(ownerId) : scope.scope === "department";
  }

  // ─── Deals ──────────────────────────────────────────────────

  private async deals(tx: Tx, lookups: Lookups, sheet: Sheet, mapping: string[], write: boolean): Promise<Outcome> {
    const { ctx } = lookups;
    const summary: ImportSummary = { create: 0, update: 0, skip: 0, failed: 0, companies: 0 };
    const issues: ImportIssue[] = [];
    const issueLines = new Set<number>();
    const rows = sheet.data.map((r) => this.cells(r, mapping));

    const [tenant, pipelines, stages] = await Promise.all([
      tx.tenant.get({ id: ctx.tenantId }, { projection: { currency: 1, fxRates: 1 } }),
      tx.pipeline.find({ tenantId: ctx.tenantId }, { sort: { isDefault: -1, name: 1 } }),
      tx.pipelineStage.find({ tenantId: ctx.tenantId }, { sort: { order: 1 } }),
    ]);
    const pipelineByName = new Map(pipelines.map((p) => [norm(p.name), p]));
    const defaultPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];

    // Customers by email, phone or (unique) name, among those the importer can see
    const refs = rows.map((c) => c.get("contact") ?? "").filter(Boolean);
    const contactPhones = refs.map((r) => contactCreateSchema.shape.phone.safeParse(r).data).filter((v): v is string => !!v);
    const contacts = refs.length
      ? await tx.contact.find(
          and({ tenantId: ctx.tenantId, deletedAt: null }, lookups.scope.where, {
            $or: [{ email: { $in: refs.map((r) => r.toLowerCase()) } }, { phone: { $in: contactPhones } }, { name: { $in: refs } }],
          }),
          { projection: { id: 1, name: 1, email: 1, phone: 1 } },
        )
      : [];
    const contactBy = new Map<string, string | null>();
    for (const c of contacts) {
      if (c.email) contactBy.set(`e:${c.email}`, c.id);
      if (c.phone) contactBy.set(`p:${c.phone}`, c.id);
      const key = `n:${norm(c.name)}`;
      contactBy.set(key, contactBy.has(key) && contactBy.get(key) !== c.id ? null : c.id);
    }

    const inserts: Insert<Deal>[] = [];
    rows.forEach((cells, index) => {
      const line = index + 2;
      const rowIssues = new RowIssues(line);
      const get = (k: string) => cells.get(k) || undefined;

      const title = get("title");
      if (!title) rowIssues.add("title", "required");
      else if (title.length > 150) rowIssues.add("title", "too_long", title);

      let amount = 0;
      if (get("amount")) {
        const n = parseNumber(get("amount")!);
        if (Number.isNaN(n) || n < 0 || n * 100 > 2_000_000_000) rowIssues.add("amount", "invalid_number", get("amount"));
        else amount = Math.round(n * 100);
      }
      const currency = get("currency") ? currencyCode(get("currency")!) : tenant.currency;
      let baseAmount = amount;
      if (!(CURRENCIES as readonly string[]).includes(currency)) rowIssues.add("currency", "unknown_currency", get("currency"));
      else if (currency !== tenant.currency && !tenant.fxRates?.[currency]) rowIssues.add("currency", "no_rate", currency);
      else baseAmount = toBaseAmount(amount, currency, tenant);

      const pipeline = get("pipeline") ? pipelineByName.get(norm(get("pipeline")!)) : defaultPipeline;
      if (!pipeline) rowIssues.add("pipeline", "unknown_pipeline", get("pipeline"));
      const own = stages.filter((s) => s.pipelineId === pipeline?.id);
      const stage = get("stage") ? own.find((s) => norm(s.name) === norm(get("stage")!)) : own.find((s) => s.kind === "open");
      if (pipeline && !stage) rowIssues.add("stage", "unknown_stage", get("stage"));

      let contactId: string | null = null;
      const ref = get("contact");
      if (ref) {
        const phone = contactCreateSchema.shape.phone.safeParse(ref).data;
        const id = ref.includes("@") ? contactBy.get(`e:${ref.toLowerCase()}`) : phone && contactBy.has(`p:${phone}`) ? contactBy.get(`p:${phone}`) : contactBy.get(`n:${norm(ref)}`);
        if (id === null) rowIssues.add("contact", "ambiguous_contact", ref);
        else if (!id) rowIssues.add("contact", "unknown_contact", ref);
        else contactId = id;
      }

      const dates: Record<"expectedClose" | "closedAt", Date | null> = { expectedClose: null, closedAt: null };
      for (const k of ["expectedClose", "closedAt"] as const) {
        const raw = get(k);
        if (!raw) continue;
        const d = parseDate(raw);
        if (!d) rowIssues.add(k, "invalid_date", raw);
        else dates[k] = new Date(`${d}T00:00:00.000Z`);
      }
      const ownerId = this.owner(get("owner"), lookups, rowIssues);
      const values = this.customValues(cells, lookups, rowIssues);
      const customFields = rowIssues.ok ? this.applyFields(lookups, values, null, rowIssues) : undefined;
      if (!rowIssues.ok || !pipeline || !stage) {
        summary.failed++;
        issues.push(...rowIssues.list);
        issueLines.add(line);
        return;
      }

      summary.create++;
      // History can be imported: won/lost deals keep their closing date (or the expected one, or today)
      const closed = stage.kind !== "open";
      inserts.push({
        id: createId(),
        tenantId: ctx.tenantId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: title!,
        amount,
        currency,
        baseAmount,
        customFields: (customFields ?? {}) as Deal["customFields"],
        contactId,
        ownerId: ownerId ?? ctx.membershipId,
        expectedClose: dates.expectedClose,
        closedAt: closed ? (dates.closedAt ?? dates.expectedClose ?? new Date()) : null,
        lostReason: stage.kind === "lost" ? (get("lostReason")?.slice(0, 200) ?? null) : null,
      });
    });

    const createdIds: string[] = [];
    if (write && inserts.length) {
      // Appended below each stage's current cards, in file order
      const last = await tx.deal.aggregate<{ _id: string; max: number }>([
        { $match: { tenantId: ctx.tenantId, stageId: { $in: [...new Set(inserts.map((d) => d.stageId!))] } } },
        { $group: { _id: "$stageId", max: { $max: "$position" } } },
      ]);
      const next = new Map(last.map((r) => [r._id, r.max]));
      for (const d of inserts) {
        const position = (next.get(d.stageId!) ?? 0) + POSITION_STEP;
        next.set(d.stageId!, position);
        d.position = position;
      }
      for (let i = 0; i < inserts.length; i += INSERT_CHUNK) createdIds.push(...(await tx.deal.insertMany(inserts.slice(i, i + INSERT_CHUNK))).map((d) => d.id));
    }
    return { summary, issues, issueLines, createdIds };
  }

  // ─── DTOs ───────────────────────────────────────────────────

  private toDto(job: ImportJob, refs: Map<string, { id: string; name: string }>): ImportJobDto {
    const by = job.byId ? refs.get(job.byId) : undefined;
    return {
      id: job.id,
      entity: job.entity as ImportEntity,
      fileName: job.fileName,
      duplicates: job.duplicates as ImportJobDto["duplicates"],
      rows: job.rows,
      summary: job.summary,
      by: by ? { id: by.id, name: by.name } : null,
      createdAt: job.createdAt.toISOString(),
    };
  }

  private toDetail(job: ImportJob, refs: Map<string, { id: string; name: string }>): ImportJobDetailDto {
    return {
      ...this.toDto(job, refs),
      headers: job.headers,
      mapping: job.mapping,
      issues: job.issues as unknown as ImportIssue[],
      issueRows: job.issueRows as unknown as ImportJobDetailDto["issueRows"],
    };
  }
}
