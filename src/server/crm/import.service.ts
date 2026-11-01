import {
  CURRENCIES,
  IMPORT_COLUMNS,
  IMPORT_ENTITIES,
  WORKBOOK_ORDER,
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
  type WorkbookOptions,
  type WorkbookResultDto,
  type WorkbookSheetDto,
} from "@/shared";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../billing/entitlements.service";
import { authedContext, currentContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { readSheet, readXlsxBook, TabularError } from "../common/tabular";
import { startOfDay } from "../common/time";
import type { Database, Tx } from "../db/database";
import type { Contact, Deal, FieldDefinition, ImportJob, Product, Task } from "../db/models";
import { and } from "../db/query";
import { createId, type Insert } from "../db/repo";
import type { UploadedFile } from "../tasks/files.service";
import { DICTIONARIES, LIFECYCLE_LOOKUP, PRIORITY_LOOKUP, SOURCE_LOOKUP, TASK_STATUS_LOOKUP, currencyCode, headerKeys, norm, normalizePhone, parseBool, parseDate, parseNumber, splitList, splitPhones } from "./data-files";
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
  /** Values overwritten by updates, to put back on undo */
  undo: { id: string; set: Record<string, unknown> }[];
}

/** Thrown inside a workbook preview so the transaction rolls back after a full dry run */
class DryRun extends Error {
  constructor(readonly result: WorkbookSheetDto[]) {
    super("dry run");
  }
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
        batchId: null,
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
        undo: outcome.undo,
        undoneAt: null,
        byId: ctx.membershipId,
      });
      await this.audit.log(tx, { action: "import.completed", entityType: "import", entityId: job.id, diff: { entity: options.entity, file: sheet.fileName, rows: sheet.data.length, ...outcome.summary } });
      return this.toDetail(job, await memberRefs(tx, ctx.tenantId, [job.byId]));
    });
  }

  async history(): Promise<ImportJobDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const rows = await tx.importJob.find({ tenantId: ctx.tenantId }, { sort: { createdAt: -1 }, limit: 30, projection: { issues: 0, issueRows: 0, createdIds: 0, undo: 0 } });
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


  // ─── Workbooks: every sheet in one go ───────────────────────

  /** A full dry run: everything is written inside the transaction, then rolled back. */
  async workbookPreview(file: UploadedFile | undefined, options: WorkbookOptions): Promise<WorkbookResultDto> {
    const { fileName, sheets } = this.readBook(file, options);
    try {
      await this.db.scoped(async (tx) => {
        throw new DryRun(await this.processBook(tx, sheets, options, null));
      });
    } catch (e) {
      if (e instanceof DryRun) return { fileName, sheets: e.result, batchId: null };
      throw e;
    }
    throw new Error("unreachable");
  }

  async workbookRun(file: UploadedFile | undefined, options: WorkbookOptions): Promise<WorkbookResultDto> {
    const { fileName, sheets } = this.readBook(file, options);
    if (!sheets.some((s) => s.entity)) throw new AppError("VALIDATION_FAILED", "No recognised sheets", { file: ["no_sheets"] });
    const batchId = createId();
    const result = await this.db.scoped((tx) => this.processBook(tx, sheets, options, batchId));
    return { fileName, sheets: result, batchId };
  }

  private readBook(file: UploadedFile | undefined, options: WorkbookOptions) {
    this.checkFile(file);
    let tabs: { name: string; rows: string[][] }[];
    try {
      tabs = /\.xlsx$/i.test(file.originalname) ? readXlsxBook(file.buffer) : [{ name: file.originalname.replace(/\.[^.]+$/, ""), rows: readSheet(file.buffer, file.originalname) }];
    } catch (e) {
      if (e instanceof TabularError) throw new AppError("VALIDATION_FAILED", "Unreadable file", { file: [e.reason] });
      throw e;
    }
    const total = tabs.reduce((n, t) => n + Math.max(0, t.rows.length - 1), 0);
    if (total > IMPORT_LIMITS.rows * 2) throw new AppError("VALIDATION_FAILED", "Too many rows", { file: ["too_many_rows"] });
    const sheets = tabs
      .filter((t) => t.rows.length > 1)
      .map((t) => {
        const sheet = this.sheet(t.rows, `${file.originalname} · ${t.name}`);
        const chosen = options.sheets?.[t.name];
        return { tab: t.name, sheet, entity: chosen === "" ? null : (chosen ?? detectEntity(t.name, sheet.headers)) };
      });
    if (!sheets.length) throw new AppError("VALIDATION_FAILED", "No data rows", { file: ["empty"] });
    return { fileName: file.originalname.slice(0, 200), sheets };
  }

  /** Sheets in dependency order (companies → people → products → deals → tasks), each like a single import. */
  private async processBook(tx: Tx, sheets: { tab: string; sheet: Sheet; entity: ImportEntity | null }[], options: WorkbookOptions, batchId: string | null): Promise<WorkbookSheetDto[]> {
    const ctx = authedContext();
    const out = new Map<string, WorkbookSheetDto>();
    const empty = { create: 0, update: 0, skip: 0, failed: 0, companies: 0 };
    for (const s of sheets) if (!s.entity) out.set(s.tab, { sheet: s.tab, entity: null, headers: s.sheet.headers, mapping: [], rows: s.sheet.data.length, missing: [], summary: empty, issues: [], issueCount: 0 });
    for (const entity of WORKBOOK_ORDER) {
      for (const s of sheets.filter((x) => x.entity === entity)) {
        const single: ImportOptions = { entity, duplicates: options.duplicates, createCompanies: options.createCompanies };
        this.checkAccess(single);
        const lookups = await this.lookups(tx, ctx, entity);
        const mapping = this.mapping(s.sheet, single, lookups.defs);
        const missing = this.missing(entity, mapping);
        const outcome = missing.length ? null : await this.process(tx, lookups, s.sheet, mapping, single, true);
        out.set(s.tab, {
          sheet: s.tab,
          entity,
          headers: s.sheet.headers,
          mapping,
          rows: s.sheet.data.length,
          missing,
          summary: outcome?.summary ?? empty,
          issues: outcome?.issues.slice(0, PREVIEW_ISSUES) ?? [],
          issueCount: outcome?.issues.length ?? 0,
        });
        if (batchId && outcome) {
          const job = await tx.importJob.insertOne({
            tenantId: ctx.tenantId,
            batchId,
            entity,
            fileName: s.sheet.fileName,
            duplicates: options.duplicates,
            rows: s.sheet.data.length,
            headers: s.sheet.headers,
            mapping,
            summary: outcome.summary,
            issues: outcome.issues.slice(0, MAX_STORED_ISSUES) as unknown as ImportJob["issues"],
            issueRows: [...outcome.issueLines].slice(0, MAX_STORED_ISSUES).map((row) => ({ row, cells: s.sheet.data[row - 2] ?? [] })) as unknown as ImportJob["issueRows"],
            createdIds: outcome.createdIds,
            undo: outcome.undo,
            undoneAt: null,
            byId: ctx.membershipId,
          });
          await this.audit.log(tx, { action: "import.completed", entityType: "import", entityId: job.id, diff: { entity, file: s.sheet.fileName, rows: s.sheet.data.length, batchId, ...outcome.summary } });
        }
      }
    }
    return sheets.map((s) => out.get(s.tab)!);
  }

  // ─── Undo ───────────────────────────────────────────────────

  /**
   * Takes an import back (with its whole workbook): customers it created go to the
   * deleted list (restorable), products it created are archived, deals and tasks it
   * created are removed, and records it updated get their earlier values back.
   */
  async undo(id: string): Promise<ImportJobDto[]> {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const job = await tx.importJob.findOne({ id, tenantId: ctx.tenantId });
      if (!job) throw notFound("Import");
      const jobs = job.batchId ? await tx.importJob.find({ tenantId: ctx.tenantId, batchId: job.batchId }) : [job];
      if (jobs.some((j) => j.undoneAt)) throw new AppError("CONFLICT", "Already undone");
      for (const j of jobs) this.checkAccess({ entity: j.entity as ImportEntity, duplicates: "skip", createCompanies: false });
      const now = new Date();
      // Dependents first: tasks and deals point at customers
      const order = [...WORKBOOK_ORDER].reverse();
      for (const j of [...jobs].sort((a, b) => order.indexOf(a.entity as ImportEntity) - order.indexOf(b.entity as ImportEntity))) {
        const ids = j.createdIds;
        const where = { tenantId: ctx.tenantId, id: { $in: ids } };
        switch (j.entity) {
          case "task":
            if (ids.length) await tx.task.deleteMany(where);
            break;
          case "deal":
            if (ids.length) await tx.deal.deleteMany(where);
            break;
          case "product":
            if (ids.length) await tx.product.updateMany(where, { $set: { active: false } });
            for (const u of j.undo ?? []) await tx.product.update({ id: u.id, tenantId: ctx.tenantId }, { $set: u.set as Partial<Product> });
            break;
          default:
            if (ids.length) await tx.contact.updateMany({ ...where, deletedAt: null }, { $set: { deletedAt: now } });
            for (const u of j.undo ?? []) await tx.contact.update({ id: u.id, tenantId: ctx.tenantId }, { $set: u.set as Partial<Contact> });
        }
        await tx.importJob.update({ id: j.id, tenantId: ctx.tenantId }, { $set: { undoneAt: now } });
        await this.audit.log(tx, { action: "import.undone", entityType: "import", entityId: j.id, diff: { entity: j.entity, created: ids.length, restored: (j.undo ?? []).length } });
      }
    });
    return this.history();
  }

  // ─── Reading and mapping ────────────────────────────────────

  private read(file: UploadedFile | undefined): Sheet {
    this.checkFile(file);
    let rows: string[][];
    try {
      rows = readSheet(file.buffer, file.originalname);
    } catch (e) {
      if (e instanceof TabularError) throw new AppError("VALIDATION_FAILED", "Unreadable file", { file: [e.reason] });
      throw e;
    }
    return this.sheet(rows, file.originalname);
  }

  private checkFile(file: UploadedFile | undefined): asserts file is UploadedFile {
    if (!file) throw new AppError("VALIDATION_FAILED", "A file is required", { file: ["required"] });
    if (file.size > IMPORT_LIMITS.fileMb * 1024 * 1024) throw new AppError("FILE_TOO_LARGE", "File too large", { file: ["too_large"] });
  }

  private sheet(rows: string[][], fileName: string): Sheet {
    const [headerRow, ...data] = rows;
    if (!data.length) throw new AppError("VALIDATION_FAILED", "No data rows", { file: ["empty"] });
    if (data.length > IMPORT_LIMITS.rows) throw new AppError("VALIDATION_FAILED", "Too many rows", { file: ["too_many_rows"] });
    const width = Math.max(...rows.map((r) => r.length));
    if (width > IMPORT_LIMITS.columns) throw new AppError("VALIDATION_FAILED", "Too many columns", { file: ["too_many_columns"] });
    const headers = Array.from({ length: width }, (_, i) => headerRow![i] ?? "");
    return { fileName: fileName.slice(0, 200), headers, data: data.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")) };
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
    // People may come as separate first/last name columns (HubSpot, Bitrix24, …)
    if (entity === "person" && (mapping.includes("firstName") || mapping.includes("lastName"))) return [];
    return mapping.includes(REQUIRED_COLUMNS[entity]) ? [] : [REQUIRED_COLUMNS[entity]];
  }

  /** Importing creates (and in update mode changes) records: the same rights as doing it by hand. */
  private checkAccess({ entity, duplicates }: ImportOptions) {
    const ctx = currentContext();
    if (entity === "deal" && !ctx.features?.includes("deals.pipeline")) {
      throw new AppError("FEATURE_NOT_IN_PLAN", "Deals are not in the plan", { feature: "deals.pipeline" });
    }
    const needed: Permission[] =
      entity === "deal"
        ? ["deals.create"]
        : entity === "product"
          ? ["products.manage"]
          : entity === "task"
            ? ["tasks.create"]
            : ["contacts.create", ...(duplicates === "update" ? (["contacts.edit"] as const) : [])];
    const lacking = needed.find((p) => !ctx.permissions?.includes(p));
    if (lacking) throw forbidden(`Requires permission ${lacking}`);
  }

  private async lookups(tx: Tx, ctx: AuthedContext, entity: ImportEntity): Promise<Lookups> {
    // Products and tasks have no custom fields
    const fieldEntity = entity === "deal" ? "deal" : entity === "person" || entity === "company" ? contactEntity(entity) : null;
    const [scope, defs, memberships] = await Promise.all([
      ownerScope(tx, ctx, "contacts.view_all"),
      fieldEntity ? tx.fieldDefinition.find({ tenantId: ctx.tenantId, entity: fieldEntity, archived: false }) : [],
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
    switch (options.entity) {
      case "deal":
        return this.deals(tx, lookups, sheet, mapping, write);
      case "product":
        return this.products(tx, lookups, sheet, mapping, options, write);
      case "task":
        return this.tasks(tx, lookups, sheet, mapping, write);
      default:
        return this.contacts(tx, lookups, sheet, mapping, options, write);
    }
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
    const phones = rows.flatMap((c) => [...splitPhones(c.get("phone") ?? ""), ...splitPhones(c.get("phone2") ?? "")].map((p) => p.phone)).filter((v): v is string => !!v);
    const typeFilter = isCompany ? { type: "company" } : { type: { $ne: "company" } };
    // Everything an update may overwrite is read, so undo can put it back
    const projection = { id: 1, name: 1, email: 1, phone: 1, extraPhones: 1, ownerId: 1, tags: 1, customFields: 1, type: 1, stage: 1, source: 1, companyId: 1, companyName: 1 } as const;
    const candidates = await tx.contact.find(
      { tenantId: ctx.tenantId, deletedAt: null, ...typeFilter, $or: [{ email: { $in: emails } }, { phone: { $in: phones } }, { extraPhones: { $in: phones } }] },
      { projection },
    );
    // Companies by name: for company rows (duplicates) and people's company column (links)
    const companies = isCompany || mapping.includes("company") ? await tx.contact.find({ tenantId: ctx.tenantId, deletedAt: null, type: "company" }, { projection }) : [];
    const byEmail = new Map(candidates.filter((c) => c.email).map((c) => [c.email!, c]));
    const byPhone = new Map(candidates.flatMap((c) => [c.phone, ...(c.extraPhones ?? [])].filter((p): p is string => !!p).map((p) => [p, c] as const)));
    const companyByName = new Map(companies.map((c) => [norm(c.name), c]));
    const byName = isCompany ? companyByName : new Map<string, (typeof companies)[number]>();

    // People's companies not in the database: created once each, unless companies have required fields
    const companyFieldsRequired = !isCompany && options.createCompanies && (await tx.fieldDefinition.count({ tenantId: ctx.tenantId, entity: "company", archived: false, required: true })) > 0;
    const newCompanies = new Map<string, { id: string; name: string; ownerId: string | null }>();

    const seen = new Map<string, number>();
    const inserts: Insert<Contact>[] = [];
    const updates: { id: string; set: Partial<Contact> }[] = [];
    const undo: Outcome["undo"] = [];

    rows.forEach((cells, index) => {
      const line = index + 2;
      const rowIssues = new RowIssues(line);
      const get = (k: string) => cells.get(k) || undefined;

      // "Name", or first + last name columns; a lone last-name column completes "Name"
      const parts = [get("firstName"), get("lastName")].filter(Boolean).join(" ");
      const name = get("name") ? [get("name"), !get("firstName") && get("lastName")].filter(Boolean).join(" ") : parts || undefined;
      if (name && name.length > 150) rowIssues.add("name", "too_long", name);
      const email = this.parse(schema.email, get("email"), "email", "invalid_email", rowIssues);
      // Every number in the phone columns, normalised; the first is the main one
      const numbers: string[] = [];
      for (const key of ["phone", "phone2"]) {
        for (const p of splitPhones(get(key) ?? "")) {
          if (!p.phone) rowIssues.add(key, "invalid_phone", p.raw);
          else if (!numbers.includes(p.phone)) numbers.push(p.phone);
        }
      }
      const phone = numbers[0];
      const extraPhones = numbers.slice(1, 11);
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
      const keys = [email && `e:${email}`, ...numbers.map((p) => `p:${p}`), isCompany && name && `n:${norm(name)}`].filter((k): k is string => !!k);
      const match = (email && byEmail.get(email)) || numbers.map((p) => byPhone.get(p)).find(Boolean) || (isCompany && name && byName.get(norm(name))) || null;
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
        const known = [update.phone, ...(update.extraPhones ?? [])].filter(Boolean);
        const added = numbers.filter((p) => !known.includes(p));
        const set: Partial<Contact> = {
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
          ...(added.length ? (update.phone ? { extraPhones: [...(update.extraPhones ?? []), ...added].slice(0, 10) } : { phone: added[0], extraPhones: [...(update.extraPhones ?? []), ...added.slice(1)].slice(0, 10) }) : {}),
          ...(stage ? { stage } : {}),
          ...(source ? { source } : {}),
          ...(ownerId ? { ownerId } : {}),
          ...(company ?? {}),
          ...(tags ? { tags: [...new Set([...update.tags, ...tags])].slice(0, 20) } : {}),
          ...(Object.keys(values).length ? { customFields: customFields as Contact["customFields"] } : {}),
        };
        if (Object.keys(set).length) {
          updates.push({ id: update.id, set });
          undo.push({ id: update.id, set: Object.fromEntries(Object.keys(set).map((k) => [k, (update as unknown as Record<string, unknown>)[k] ?? null])) });
        }
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
        extraPhones,
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
    return { summary, issues, issueLines, createdIds, undo };
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

    const findContact = await this.contactResolver(tx, lookups, rows.map((c) => c.get("contact") ?? ""));

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

      const contactId = this.contactRef(get("contact"), findContact, rowIssues);

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
    return { summary, issues, issueLines, createdIds, undo: [] };
  }


  /**
   * Customers by email, phone (any of their numbers) or unique name, among those the
   * importer can see; the returned lookup gives an id, null (ambiguous) or undefined.
   */
  private async contactResolver(tx: Tx, lookups: Lookups, refs: string[]) {
    const { ctx } = lookups;
    const given = refs.filter(Boolean);
    const phones = given.map((r) => normalizePhone(r)).filter((v): v is string => !!v);
    const contacts = given.length
      ? await tx.contact.find(
          and({ tenantId: ctx.tenantId, deletedAt: null }, lookups.scope.where, {
            $or: [{ email: { $in: given.map((r) => r.toLowerCase()) } }, { phone: { $in: phones } }, { extraPhones: { $in: phones } }, { name: { $in: given } }],
          }),
          { projection: { id: 1, name: 1, email: 1, phone: 1, extraPhones: 1 } },
        )
      : [];
    const by = new Map<string, string | null>();
    for (const c of contacts) {
      if (c.email) by.set(`e:${c.email}`, c.id);
      for (const p of [c.phone, ...(c.extraPhones ?? [])]) if (p) by.set(`p:${p}`, c.id);
      const key = `n:${norm(c.name)}`;
      by.set(key, by.has(key) && by.get(key) !== c.id ? null : c.id);
    }
    return (ref: string) => {
      const phone = normalizePhone(ref);
      return ref.includes("@") ? by.get(`e:${ref.toLowerCase()}`) : phone && by.has(`p:${phone}`) ? by.get(`p:${phone}`) : by.get(`n:${norm(ref)}`);
    };
  }

  private contactRef(ref: string | undefined, find: (ref: string) => string | null | undefined, issues: RowIssues): string | null {
    if (!ref) return null;
    const id = find(ref);
    if (id === null) issues.add("contact", "ambiguous_contact", ref);
    else if (!id) issues.add("contact", "unknown_contact", ref);
    return id ?? null;
  }

  // ─── Products ───────────────────────────────────────────────

  /** Catalog rows; the same SKU (or, without one, the same name) is the same product. */
  private async products(tx: Tx, lookups: Lookups, sheet: Sheet, mapping: string[], options: ImportOptions, write: boolean): Promise<Outcome> {
    const { ctx } = lookups;
    const summary: ImportSummary = { create: 0, update: 0, skip: 0, failed: 0, companies: 0 };
    const issues: ImportIssue[] = [];
    const issueLines = new Set<number>();
    const rows = sheet.data.map((r) => this.cells(r, mapping));
    const [tenant, existing] = await Promise.all([
      tx.tenant.get({ id: ctx.tenantId }, { projection: { currency: 1 } }),
      tx.product.find({ tenantId: ctx.tenantId }, { projection: { id: 1, name: 1, sku: 1, unit: 1, price: 1, currency: 1, taxBp: 1, description: 1, active: 1 } }),
    ]);
    const bySku = new Map(existing.filter((p) => p.sku).map((p) => [norm(p.sku!), p]));
    const byName = new Map(existing.map((p) => [norm(p.name), p]));
    const seen = new Map<string, number>();
    const inserts: Insert<Product>[] = [];
    const updates: { id: string; set: Partial<Product> }[] = [];
    const undo: Outcome["undo"] = [];

    rows.forEach((cells, index) => {
      const line = index + 2;
      const rowIssues = new RowIssues(line);
      const get = (k: string) => cells.get(k) || undefined;
      const name = get("name");
      if (name && name.length > 200) rowIssues.add("name", "too_long", name);
      const sku = get("sku")?.slice(0, 60);
      let price: number | undefined;
      if (get("price")) {
        const n = parseNumber(get("price")!);
        if (Number.isNaN(n) || n < 0 || n * 100 > 2_000_000_000) rowIssues.add("price", "invalid_number", get("price"));
        else price = Math.round(n * 100);
      }
      const currency = get("currency") ? currencyCode(get("currency")!) : undefined;
      if (currency && !(CURRENCIES as readonly string[]).includes(currency)) rowIssues.add("currency", "unknown_currency", get("currency"));
      let taxBp: number | undefined;
      if (get("tax")) {
        const n = parseNumber(get("tax")!.replace("%", ""));
        // "18", "18%" or "0.18" all mean 18 %
        const pct = n > 0 && n < 1 ? n * 100 : n;
        if (Number.isNaN(n) || pct < 0 || pct > 100) rowIssues.add("tax", "invalid_number", get("tax"));
        else taxBp = Math.round(pct * 100);
      }
      const key = sku ? `s:${norm(sku)}` : name ? `n:${norm(name)}` : undefined;
      const match = (sku && bySku.get(norm(sku))) || (name && byName.get(norm(name))) || null;
      if (options.duplicates !== "create" && key) {
        const earlier = seen.get(key);
        if (earlier !== undefined) return skip("duplicate_in_file", String(earlier));
        if (match && options.duplicates === "skip") return skip("duplicate", match.name);
      }
      function skip(code: IssueCode, value: string) {
        summary.skip++;
        issues.push({ row: line, code, value: cut(value), skipped: true });
        issueLines.add(line);
      }
      const update = match && options.duplicates === "update" ? match : null;
      if (!update && !name) rowIssues.add("name", "required");
      if (!rowIssues.ok) {
        summary.failed++;
        issues.push(...rowIssues.list);
        issueLines.add(line);
        return;
      }
      if (key) seen.set(key, line);
      const fields: Partial<Product> = {
        ...(name ? { name } : {}),
        ...(sku ? { sku } : {}),
        ...(get("unit") ? { unit: get("unit")!.slice(0, 20) } : {}),
        ...(price !== undefined ? { price } : {}),
        ...(currency ? { currency } : {}),
        ...(taxBp !== undefined ? { taxBp } : {}),
        ...(get("description") ? { description: get("description")!.slice(0, 2000) } : {}),
      };
      if (update) {
        summary.update++;
        updates.push({ id: update.id, set: fields });
        undo.push({ id: update.id, set: Object.fromEntries(Object.keys(fields).map((k) => [k, (update as unknown as Record<string, unknown>)[k] ?? null])) });
        return;
      }
      summary.create++;
      inserts.push({ id: createId(), tenantId: ctx.tenantId, name: name!, price: 0, currency: tenant.currency, ...fields });
    });

    const createdIds: string[] = [];
    if (write) {
      for (let i = 0; i < inserts.length; i += INSERT_CHUNK) createdIds.push(...(await tx.product.insertMany(inserts.slice(i, i + INSERT_CHUNK))).map((p) => p.id));
      for (const u of updates) await tx.product.update({ id: u.id, tenantId: ctx.tenantId }, { $set: u.set });
    }
    return { summary, issues, issueLines, createdIds, undo };
  }

  // ─── Tasks ──────────────────────────────────────────────────

  /** To-dos (calls to make, things to send); assigned like a manual task, linked to a visible customer. */
  private async tasks(tx: Tx, lookups: Lookups, sheet: Sheet, mapping: string[], write: boolean): Promise<Outcome> {
    const { ctx } = lookups;
    const summary: ImportSummary = { create: 0, update: 0, skip: 0, failed: 0, companies: 0 };
    const issues: ImportIssue[] = [];
    const issueLines = new Set<number>();
    const rows = sheet.data.map((r) => this.cells(r, mapping));
    const [tenant, findContact] = await Promise.all([
      tx.tenant.get({ id: ctx.tenantId }, { projection: { timezone: 1 } }),
      this.contactResolver(tx, lookups, rows.map((c) => c.get("contact") ?? "")),
    ]);
    const assignAny = ctx.permissions.includes("tasks.assign_any");
    const inserts: Insert<Task>[] = [];

    rows.forEach((cells, index) => {
      const line = index + 2;
      const rowIssues = new RowIssues(line);
      const get = (k: string) => cells.get(k) || undefined;
      const title = get("title");
      if (!title) rowIssues.add("title", "required");
      else if (title.length > 200) rowIssues.add("title", "too_long", title);
      let dueAt: Date | null = null;
      if (get("dueAt")) {
        const d = parseDate(get("dueAt")!);
        // A date alone means the end of the working day (18:00) in the company's time zone
        if (!d) rowIssues.add("dueAt", "invalid_date", get("dueAt"));
        else dueAt = new Date(startOfDay(new Date(`${d}T12:00:00Z`), tenant.timezone).getTime() + 18 * 3_600_000);
      }
      const priority = get("priority") ? PRIORITY_LOOKUP.get(norm(get("priority")!)) : "MEDIUM";
      if (!priority) rowIssues.add("priority", "invalid_value", get("priority"));
      const status = get("status") ? TASK_STATUS_LOOKUP.get(norm(get("status")!)) : "TODO";
      if (!status) rowIssues.add("status", "invalid_value", get("status"));
      let assigneeId: string = ctx.membershipId;
      if (get("owner") && assignAny) {
        const id = lookups.members.get(norm(get("owner")!));
        if (!id) rowIssues.add("owner", "unknown_owner", get("owner"));
        else assigneeId = id;
      }
      const contactId = this.contactRef(get("contact"), findContact, rowIssues);
      if (!rowIssues.ok || !priority || !status) {
        summary.failed++;
        issues.push(...rowIssues.list);
        issueLines.add(line);
        return;
      }
      summary.create++;
      inserts.push({
        id: createId(),
        tenantId: ctx.tenantId,
        title: title!,
        description: get("description")?.slice(0, 5000) ?? null,
        status,
        priority,
        creatorId: ctx.membershipId,
        assigneeId,
        dueAt,
        completedAt: status === "DONE" ? new Date() : null,
        // Past due dates of imported tasks are history, not fresh alerts
        overdueNotifiedAt: dueAt && dueAt < new Date() ? new Date() : null,
        contactId,
        position: (index + 1) * POSITION_STEP,
      });
    });

    const createdIds: string[] = [];
    if (write) for (let i = 0; i < inserts.length; i += INSERT_CHUNK) createdIds.push(...(await tx.task.insertMany(inserts.slice(i, i + INSERT_CHUNK))).map((t) => t.id));
    return { summary, issues, issueLines, createdIds, undo: [] };
  }

  // ─── DTOs ───────────────────────────────────────────────────

  private toDto(job: ImportJob, refs: Map<string, { id: string; name: string }>): ImportJobDto {
    const by = job.byId ? refs.get(job.byId) : undefined;
    return {
      id: job.id,
      batchId: job.batchId ?? null,
      entity: job.entity as ImportEntity,
      fileName: job.fileName,
      duplicates: job.duplicates as ImportJobDto["duplicates"],
      rows: job.rows,
      summary: job.summary,
      by: by ? { id: by.id, name: by.name } : null,
      createdAt: job.createdAt.toISOString(),
      undoneAt: job.undoneAt?.toISOString() ?? null,
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

/** Names people give each kind of sheet (besides the entity names in all three languages) */
const SHEET_NAMES: Record<ImportEntity, string[]> = {
  person: ["kontaktlar", "müştərilər", "musteriler", "contacts", "people", "customers", "клиенты", "контакты", "leads", "lidlər"],
  company: ["şirkətlər", "companies", "organizations", "accounts", "компании", "организации"],
  deal: ["satışlar", "deals", "opportunities", "сделки", "продажи"],
  product: ["məhsullar", "xidmətlər", "products", "services", "catalog", "товары", "услуги", "каталог"],
  task: ["tapşırıqlar", "tasks", "todo", "задачи", "дела"],
};

/** What a sheet holds: by its tab name, else by which entity's columns its headers match best. */
function detectEntity(tab: string, headers: string[]): ImportEntity | null {
  const name = norm(tab);
  for (const entity of IMPORT_ENTITIES) {
    const names = [...SHEET_NAMES[entity], ...Object.values(DICTIONARIES).map((d) => d.imports.entities[entity])];
    if (names.some((n) => norm(n) === name)) return entity;
  }
  let best: { entity: ImportEntity; score: number } | null = null;
  for (const entity of WORKBOOK_ORDER) {
    const keys = headerKeys(entity, IMPORT_COLUMNS[entity]);
    const found = new Set(headers.map((h) => keys.get(norm(h))).filter(Boolean));
    const required = found.has(REQUIRED_COLUMNS[entity]) || (entity === "person" && (found.has("firstName") || found.has("lastName")));
    if (required && found.size >= 2 && (!best || found.size > best.score)) best = { entity, score: found.size };
  }
  return best?.entity ?? null;
}
