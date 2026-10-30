import { IMPORT_COLUMNS, type ContactExportQuery, type DealExportQuery, type ExportFormat, type ImportEntity } from "@/shared";
import type { Locale } from "@/lib/i18n/locales";
import { AuditService } from "../audit/audit.service";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import type { Cell } from "../common/tabular";
import type { Database, Tx } from "../db/database";
import type { FieldDefinition } from "../db/models";
import { and } from "../db/query";
import { contactListWhere } from "./contacts.service";
import { DICTIONARIES, columnLabel, fileResponse } from "./data-files";
import { memberRefs, ownerScope } from "./scope";
import { contactEntity } from "./settings.service";

/** More rows than this is a backup job, not a spreadsheet */
const MAX_EXPORT_ROWS = 50_000;

const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/** A stored custom value as a cell (the way the importer reads it back). */
function fieldCell(def: FieldDefinition, value: unknown, lang: Locale): Cell {
  if (value === null || value === undefined) return "";
  switch (def.type) {
    case "currency":
      return typeof value === "number" ? value / 100 : "";
    case "checkbox":
      return value === true ? DICTIONARIES[lang].crm.yes : "";
    case "multiselect":
      return Array.isArray(value) ? value.join(", ") : "";
    case "number":
      return typeof value === "number" ? value : "";
    default:
      return String(value);
  }
}

/**
 * Spreadsheet exports of what the user can see (their contact list with its filters,
 * a pipeline's deals), with columns named the way the importer reads them back.
 * Each export is written to the audit log: it is the easiest way to take data out.
 */
export class ExportService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async contacts(query: ContactExportQuery): Promise<Response> {
    const ctx = authedContext();
    const { format, lang, ...filters } = query;
    const d = DICTIONARIES[lang];
    const rows = await this.db.scoped(async (tx) => {
      const where = await contactListWhere(tx, ctx, filters);
      const contacts = await tx.contact.find(where, { sort: { createdAt: -1, id: -1 }, limit: MAX_EXPORT_ROWS + 1 });
      if (contacts.length > MAX_EXPORT_ROWS) throw new AppError("VALIDATION_FAILED", "Too many rows to export", { rows: [`> ${MAX_EXPORT_ROWS}`] });
      // People and companies have their own fields; a mixed list gets both sets
      const entities = filters.type ? [contactEntity(filters.type)] : ["contact", "company"];
      const defs = await tx.fieldDefinition.find({ tenantId: ctx.tenantId, entity: { $in: entities } }, { sort: { entity: -1, order: 1 } });
      const refs = await memberRefs(tx, ctx.tenantId, contacts.map((c) => c.ownerId));
      const keys = ["type", "name", "email", "phone", "company", "stage", "source", "tags", "owner", "createdAt"] as const;
      const header: Cell[] = [...keys.map((k) => columnLabel(lang, "person", k)), ...defs.map((f) => f.label)];
      const body = contacts.map((c): Cell[] => [
        c.type === "company" ? d.crm.company : d.crm.person,
        c.name,
        c.email,
        c.phone,
        c.companyName,
        d.crm.stages[c.stage] ?? c.stage,
        c.source ? (d.crm.sources[c.source as keyof typeof d.crm.sources] ?? c.source) : "",
        c.tags.join(", "),
        c.ownerId ? (refs.get(c.ownerId)?.name ?? "") : "",
        isoDate(c.createdAt),
        // A person's row leaves company fields empty and the other way round
        ...defs.map((f) => (f.entity === contactEntity(c.type) ? fieldCell(f, (c.customFields as Record<string, unknown>)?.[f.id], lang) : "")),
      ]);
      await this.audit.log(tx, { action: "contacts.exported", entityType: "contact", entityId: ctx.tenantId, diff: { rows: body.length, format, filters } });
      return [header, ...body];
    });
    return fileResponse(rows, format, "customers", d.crm.title);
  }

  async deals(query: DealExportQuery): Promise<Response> {
    const ctx = authedContext();
    const { format, lang } = query;
    const d = DICTIONARIES[lang];
    const rows = await this.db.scoped(async (tx) => {
      const pipeline = await tx.pipeline.findOne(query.pipelineId ? { id: query.pipelineId, tenantId: ctx.tenantId } : { tenantId: ctx.tenantId, isDefault: true });
      if (!pipeline) throw notFound("Pipeline");
      const { where: scoped } = await ownerScope(tx, ctx, "contacts.view_all");
      const [deals, stages, defs, tenant] = await Promise.all([
        tx.deal.find(and({ tenantId: ctx.tenantId, pipelineId: pipeline.id }, scoped), { sort: { createdAt: -1 }, limit: MAX_EXPORT_ROWS + 1 }),
        tx.pipelineStage.find({ tenantId: ctx.tenantId, pipelineId: pipeline.id }),
        tx.fieldDefinition.find({ tenantId: ctx.tenantId, entity: "deal" }, { sort: { order: 1 } }),
        tx.tenant.get({ id: ctx.tenantId }, { projection: { currency: 1 } }),
      ]);
      if (deals.length > MAX_EXPORT_ROWS) throw new AppError("VALIDATION_FAILED", "Too many rows to export", { rows: [`> ${MAX_EXPORT_ROWS}`] });
      const stageById = new Map(stages.map((s) => [s.id, s]));
      const contactIds = [...new Set(deals.map((x) => x.contactId).filter((x): x is string => !!x))];
      const contacts = new Map((await tx.contact.find({ tenantId: ctx.tenantId, id: { $in: contactIds } }, { projection: { id: 1, name: 1, email: 1 } })).map((c) => [c.id, c]));
      const refs = await memberRefs(tx, ctx.tenantId, deals.map((x) => x.ownerId));
      const label = (k: string) => columnLabel(lang, "deal", k);
      const header: Cell[] = [
        ...["title", "amount", "currency"].map(label),
        `${label("baseAmount")} (${tenant.currency})`,
        ...["pipeline", "stage", "result", "contact", "owner", "expectedClose", "closedAt", "lostReason", "createdAt"].map(label),
        ...defs.map((f) => f.label),
      ];
      const body = deals.map((x): Cell[] => {
        const stage = stageById.get(x.stageId);
        const contact = x.contactId ? contacts.get(x.contactId) : undefined;
        const kind = (stage?.kind ?? "open") as keyof typeof d.imports.results;
        return [
          x.title,
          x.amount / 100,
          x.currency,
          (x.baseAmount ?? x.amount) / 100,
          pipeline.name,
          stage?.name ?? "",
          d.imports.results[kind] ?? kind,
          // The email finds the customer again on import even when names repeat
          contact ? (contact.email ?? contact.name) : "",
          x.ownerId ? (refs.get(x.ownerId)?.name ?? "") : "",
          isoDate(x.expectedClose),
          isoDate(x.closedAt),
          x.lostReason,
          isoDate(x.createdAt),
          ...defs.map((f) => fieldCell(f, (x.customFields as Record<string, unknown>)?.[f.id], lang)),
        ];
      });
      await this.audit.log(tx, { action: "deals.exported", entityType: "pipeline", entityId: pipeline.id, diff: { rows: body.length, format } });
      return [header, ...body];
    });
    return fileResponse(rows, format, "deals", d.deals.title);
  }

  /** An empty file with the importer's columns (plus custom fields) and one example row. */
  async template(entity: ImportEntity, lang: Locale, format: ExportFormat): Promise<Response> {
    const ctx = authedContext();
    const defs = await this.db.scoped((tx: Tx) =>
      tx.fieldDefinition.find({ tenantId: ctx.tenantId, entity: entity === "deal" ? "deal" : contactEntity(entity), archived: false }, { sort: { order: 1 } }),
    );
    const d = DICTIONARIES[lang];
    const example: Record<string, Cell> =
      entity === "deal"
        ? { title: "Ofis mebeli", amount: 1500, currency: "AZN", contact: "aysel@example.az", expectedClose: "2026-12-31" }
        : entity === "company"
          ? { name: "Araz MMC", email: "info@araz.az", phone: "+994124000000", stage: d.crm.stages.CUSTOMER, tags: "topdan" }
          : { name: "Aysel Məmmədova", email: "aysel@example.az", phone: "+994501234567", company: "Araz MMC", stage: d.crm.stages.LEAD, source: d.crm.sources.website, tags: "vip, 2026" };
    const keys = IMPORT_COLUMNS[entity];
    const rows: Cell[][] = [[...keys.map((k) => columnLabel(lang, entity, k)), ...defs.map((f) => f.label)], [...keys.map((k) => example[k] ?? ""), ...defs.map(() => "")]];
    return fileResponse(rows, format, `import-${entity}`, d.imports.entities[entity]);
  }
}
