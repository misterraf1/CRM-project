import type {
  CurrencySettingsDto,
  CurrencySettingsInput,
  CustomFieldValues,
  DocCompany,
  DocSettings,
  DocSettingsInput,
  FieldCreateInput,
  FieldDefinitionDto,
  FieldEntity,
  FieldType,
  FieldUpdateInput,
  PipelineDto,
  StageInput,
} from "@/shared";
import { LOGO_MAX_BYTES } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import type { Database, Tx } from "../db/database";
import type { FieldDefinition, Tenant } from "../db/models";
import type { Filter } from "../db/repo";
import { contains } from "../db/query";
import type { DealsService } from "./deals.service";

/** Every company starts with this pipeline (and every new pipeline with these stages). */
export const DEFAULT_STAGES: StageInput[] = [
  { name: "Yeni", probability: 10, kind: "open" },
  { name: "Kvalifikasiya", probability: 25, kind: "open" },
  { name: "Təklif", probability: 50, kind: "open" },
  { name: "Danışıqlar", probability: 75, kind: "open" },
  { name: "Qazanıldı", probability: 100, kind: "won" },
  { name: "İtirildi", probability: 0, kind: "lost" },
];

const MAX_FIELDS_PER_ENTITY = 50;
const MAX_PIPELINES = 20;
/** Stage orders are moved here first so the (pipelineId, order) unique index never sees a clash */
const ORDER_SHIFT = 1000;

export function fieldToDto(f: FieldDefinition): FieldDefinitionDto {
  return {
    id: f.id,
    entity: f.entity as FieldEntity,
    label: f.label,
    type: f.type as FieldType,
    options: f.options,
    required: f.required,
    order: f.order,
    archived: f.archived,
  };
}

/** Which field set a contact uses: people → "contact", companies → "company". */
export const contactEntity = (type: string): FieldEntity => (type === "company" ? "company" : "contact");

const invalid = (id: string, message: string) => new AppError("VALIDATION_FAILED", "Invalid custom field", { [`cf.${id}`]: [message] });

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** One value, checked against its definition and normalised (null = clear). */
function normalise(def: FieldDefinition, raw: unknown): unknown {
  if (isEmpty(raw)) return null;
  switch (def.type) {
    case "text":
      if (typeof raw !== "string") throw invalid(def.id, "Text expected");
      return raw.trim().slice(0, 1000) || null;
    case "number":
      if (typeof raw !== "number" || !Number.isFinite(raw)) throw invalid(def.id, "Number expected");
      return raw;
    case "currency":
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw invalid(def.id, "Amount expected");
      return Math.round(raw);
    case "date":
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) throw invalid(def.id, "Date expected");
      return raw;
    case "select":
      if (typeof raw !== "string" || !def.options.includes(raw)) throw invalid(def.id, "Unknown option");
      return raw;
    case "multiselect": {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || !def.options.includes(v))) throw invalid(def.id, "Unknown option");
      return [...new Set(raw as string[])];
    }
    case "checkbox":
      if (typeof raw !== "boolean") throw invalid(def.id, "Yes/no expected");
      // Unchecked is stored as absent, so "not checked" filters match records never edited
      return raw || null;
    default:
      throw invalid(def.id, "Unknown field type");
  }
}

/**
 * Validates custom field values for a record and returns the values to store.
 * Creating (`current` null): required fields must be filled. Updating: only the given
 * fields change, and a required field can't be cleared. Unknown or archived fields are
 * rejected; values of archived fields already stored are kept.
 */
export async function checkCustomFields(
  tx: Tx,
  tenantId: string,
  entity: FieldEntity,
  input: CustomFieldValues | undefined,
  current: Record<string, unknown> | null,
): Promise<Record<string, unknown> | undefined> {
  if (input === undefined && current !== null) return undefined;
  return applyCustomFields(await tx.fieldDefinition.find({ tenantId, entity, archived: false }), input, current);
}

/** `checkCustomFields` with the entity's active definitions already loaded (imports check many rows against one set). */
export function applyCustomFields(defs: FieldDefinition[], input: CustomFieldValues | undefined, current: Record<string, unknown> | null): Record<string, unknown> {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const out: Record<string, unknown> = { ...(current ?? {}) };
  for (const [id, raw] of Object.entries(input ?? {})) {
    const def = byId.get(id);
    if (!def) throw invalid(id, "Unknown field");
    const value = normalise(def, raw);
    if (value === null) delete out[id];
    else out[id] = value;
  }
  const mustHave = current === null ? defs : defs.filter((d) => input && d.id in input);
  for (const def of mustHave) if (def.required && isEmpty(out[def.id])) throw invalid(def.id, "Required");
  return out;
}

/** Filter fragment for "records whose custom field matches this value" (list filters). */
export async function customFieldFilter(tx: Tx, tenantId: string, fieldId: string, value: string): Promise<Filter> {
  const def = await tx.fieldDefinition.findOne({ id: fieldId, tenantId });
  if (!def) throw new AppError("VALIDATION_FAILED", "Unknown field", { field: ["Unknown field"] });
  const path = `customFields.${def.id}`;
  switch (def.type) {
    case "text":
      return { [path]: contains(value) };
    case "number":
    case "currency": {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new AppError("VALIDATION_FAILED", "Number expected", { value: ["Number expected"] });
      return { [path]: def.type === "currency" ? Math.round(n * 100) : n };
    }
    case "checkbox":
      return value === "true" ? { [path]: true } : { [path]: { $ne: true } };
    default:
      // select: equal; multiselect: the array contains the option; date: equal
      return { [path]: value };
  }
}

/** A deal amount in the company currency. Throws when the currency has no rate. */
export function toBaseAmount(amount: number, currency: string, tenant: Pick<Tenant, "currency" | "fxRates">) {
  if (currency === tenant.currency) return amount;
  const rate = tenant.fxRates?.[currency];
  if (!rate) throw new AppError("VALIDATION_FAILED", "No exchange rate for this currency", { currency: [`No rate for ${currency}`] });
  return Math.round(amount * rate);
}

/** Company CRM configuration: custom fields, pipelines and stages, currency rates. */
export class CrmSettingsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly deals: DealsService,
  ) {}

  // ─── Custom fields ──────────────────────────────────────────

  async fields(entity?: FieldEntity, includeArchived = false): Promise<FieldDefinitionDto[]> {
    const { tenantId } = authedContext();
    const rows = await this.db.scoped((tx) =>
      tx.fieldDefinition.find({ tenantId, ...(entity ? { entity } : {}), ...(includeArchived ? {} : { archived: false }) }, { sort: { entity: 1, order: 1, createdAt: 1 } }),
    );
    return rows.map(fieldToDto);
  }

  async createField(input: FieldCreateInput): Promise<FieldDefinitionDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const count = await tx.fieldDefinition.count({ tenantId: ctx.tenantId, entity: input.entity });
      if (count >= MAX_FIELDS_PER_ENTITY) throw new AppError("VALIDATION_FAILED", "Too many fields", { label: [`At most ${MAX_FIELDS_PER_ENTITY}`] });
      const last = await tx.fieldDefinition.findOne({ tenantId: ctx.tenantId, entity: input.entity }, { sort: { order: -1 }, projection: { order: 1 } });
      const options = ["select", "multiselect"].includes(input.type) ? input.options : [];
      const row = await tx.fieldDefinition.insertOne({ tenantId: ctx.tenantId, ...input, options, order: (last?.order ?? 0) + 1 });
      await this.audit.log(tx, { action: "field.created", entityType: "field", entityId: row.id, diff: { entity: row.entity, label: row.label, type: row.type } });
      return fieldToDto(row);
    });
  }

  async updateField(id: string, input: FieldUpdateInput): Promise<FieldDefinitionDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const current = await tx.fieldDefinition.findOne({ id, tenantId: ctx.tenantId });
      if (!current) throw notFound("Field");
      const choice = ["select", "multiselect"].includes(current.type);
      if (input.options && !choice) throw new AppError("VALIDATION_FAILED", "This field has no options", { options: ["Not a choice field"] });
      if (input.options && input.options.length === 0) throw new AppError("VALIDATION_FAILED", "Options required", { options: ["Required"] });
      // Removing an option would orphan stored values; allow only unused ones to go
      const removed = input.options ? current.options.filter((o) => !input.options!.includes(o)) : [];
      if (removed.length) {
        const model = current.entity === "deal" ? tx.deal : tx.contact;
        const used = await model.count({ tenantId: ctx.tenantId, [`customFields.${id}`]: { $in: removed } });
        if (used) throw new AppError("CONFLICT", "Option is in use", { options: removed, records: used });
      }
      const row = await tx.fieldDefinition.update({ id }, { $set: { label: input.label, options: input.options, required: input.required, archived: input.archived } });
      await this.audit.log(tx, { action: "field.updated", entityType: "field", entityId: id, diff: Object.keys(input) });
      return fieldToDto(row);
    });
  }

  async reorderFields(entity: FieldEntity, ids: string[]): Promise<FieldDefinitionDto[]> {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const rows = await tx.fieldDefinition.find({ tenantId: ctx.tenantId, entity }, { projection: { id: 1 } });
      const known = new Set(rows.map((r) => r.id));
      if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
        throw new AppError("VALIDATION_FAILED", "The list must contain every field once", { ids: ["Mismatch"] });
      }
      for (const [i, id] of ids.entries()) await tx.fieldDefinition.update({ id }, { $set: { order: i + 1 } });
    });
    return this.fields(entity, true);
  }

  // ─── Pipelines ──────────────────────────────────────────────

  async createPipeline(name: string): Promise<PipelineDto> {
    const ctx = authedContext();
    const id = await this.db.scoped(async (tx) => {
      const count = await tx.pipeline.count({ tenantId: ctx.tenantId });
      if (count >= MAX_PIPELINES) throw new AppError("VALIDATION_FAILED", "Too many pipelines", { name: [`At most ${MAX_PIPELINES}`] });
      const pipeline = await insertPipeline(tx, ctx.tenantId, name, count === 0);
      await this.audit.log(tx, { action: "pipeline.created", entityType: "pipeline", entityId: pipeline.id, diff: { name } });
      return pipeline.id;
    });
    return (await this.pipelines()).find((p) => p.id === id)!;
  }

  async updatePipeline(id: string, input: { name?: string; isDefault?: true }): Promise<PipelineDto> {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const current = await tx.pipeline.findOne({ id, tenantId: ctx.tenantId });
      if (!current) throw notFound("Pipeline");
      if (input.isDefault && !current.isDefault) await tx.pipeline.updateMany({ tenantId: ctx.tenantId, isDefault: true }, { $set: { isDefault: false } });
      await tx.pipeline.update({ id }, { $set: { name: input.name, isDefault: input.isDefault } });
      await this.audit.log(tx, { action: "pipeline.updated", entityType: "pipeline", entityId: id, diff: input });
    });
    return (await this.pipelines()).find((p) => p.id === id)!;
  }

  /** Only an empty, non-default pipeline can go — deals are never deleted as a side effect. */
  async removePipeline(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const current = await tx.pipeline.findOne({ id, tenantId: ctx.tenantId });
      if (!current) throw notFound("Pipeline");
      if (current.isDefault) throw new AppError("CONFLICT", "The default pipeline can't be deleted", { pipeline: ["default"] });
      const deals = await tx.deal.count({ tenantId: ctx.tenantId, pipelineId: id });
      if (deals) throw new AppError("CONFLICT", "The pipeline has deals", { deals });
      await tx.pipelineStage.deleteMany({ tenantId: ctx.tenantId, pipelineId: id });
      await tx.pipeline.delete({ id });
      await this.audit.log(tx, { action: "pipeline.deleted", entityType: "pipeline", entityId: id, diff: { name: current.name } });
    });
  }

  /**
   * Replaces a pipeline's stage list (order = list order). Stages with deals can be
   * renamed, re-weighted and moved, but not removed or turned into another kind:
   * closing dates and reports depend on the kind.
   */
  async replaceStages(id: string, stages: StageInput[]): Promise<PipelineDto> {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const pipeline = await tx.pipeline.findOne({ id, tenantId: ctx.tenantId });
      if (!pipeline) throw notFound("Pipeline");
      const existing = await tx.pipelineStage.find({ tenantId: ctx.tenantId, pipelineId: id });
      const byId = new Map(existing.map((s) => [s.id, s]));
      const keptIds = stages.map((s) => s.id).filter((v): v is string => !!v);
      if (keptIds.some((sid) => !byId.has(sid)) || new Set(keptIds).size !== keptIds.length) {
        throw new AppError("VALIDATION_FAILED", "Unknown stage", { stages: ["Unknown stage"] });
      }
      const inUse = new Map(
        (await tx.deal.aggregate<{ _id: string; n: number }>([{ $match: { tenantId: ctx.tenantId, pipelineId: id } }, { $group: { _id: "$stageId", n: { $sum: 1 } } }])).map((r) => [
          r._id,
          r.n,
        ]),
      );
      const removed = existing.filter((s) => !keptIds.includes(s.id));
      const blocked = removed.filter((s) => inUse.get(s.id));
      if (blocked.length) throw new AppError("CONFLICT", "Stages with deals can't be removed", { stages: blocked.map((s) => s.name) });
      const kindChanged = stages.filter((s) => s.id && byId.get(s.id)!.kind !== s.kind && inUse.get(s.id));
      if (kindChanged.length) throw new AppError("CONFLICT", "The kind of a stage with deals can't change", { stages: kindChanged.map((s) => s.name) });

      if (removed.length) await tx.pipelineStage.deleteMany({ tenantId: ctx.tenantId, id: { $in: removed.map((s) => s.id) } });
      for (const s of existing.filter((x) => keptIds.includes(x.id))) await tx.pipelineStage.update({ id: s.id }, { $set: { order: s.order + ORDER_SHIFT } });
      for (const [order, s] of stages.entries()) {
        const fields = { name: s.name, probability: s.kind === "won" ? 100 : s.kind === "lost" ? 0 : s.probability, kind: s.kind, order };
        if (s.id) await tx.pipelineStage.update({ id: s.id }, { $set: fields });
        else await tx.pipelineStage.insertOne({ tenantId: ctx.tenantId, pipelineId: id, ...fields });
      }
      await this.audit.log(tx, { action: "pipeline.stages_updated", entityType: "pipeline", entityId: id, diff: { stages: stages.map((s) => s.name) } });
    });
    return (await this.pipelines()).find((p) => p.id === id)!;
  }

  private async pipelines(): Promise<PipelineDto[]> {
    return this.deals.pipelines();
  }

  // ─── Currencies ─────────────────────────────────────────────

  async currencies(): Promise<CurrencySettingsDto> {
    const { tenantId } = authedContext();
    const tenant = await this.db.scoped((tx) => tx.tenant.get({ id: tenantId }, { projection: { currency: 1, fxRates: 1 } }));
    return currencyDto(tenant);
  }

  /**
   * Saves the rates and re-prices open deals in other currencies. Closed deals keep
   * the amount they were closed at, so past revenue doesn't move with the rate.
   */
  async updateCurrencies(input: CurrencySettingsInput): Promise<CurrencySettingsDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { currency: 1, fxRates: 1 } });
      const rates = Object.fromEntries(Object.entries(input.rates).filter(([c]) => c !== tenant.currency));
      const dropped = Object.keys(tenant.fxRates ?? {}).filter((c) => !(c in rates));
      if (dropped.length) {
        const used = await tx.deal.count({ tenantId: ctx.tenantId, closedAt: null, currency: { $in: dropped } });
        if (used) throw new AppError("CONFLICT", "Open deals use this currency", { currencies: dropped, deals: used });
      }
      const updated = await tx.tenant.update({ id: ctx.tenantId }, { $set: { fxRates: rates } });
      for (const [currency, rate] of Object.entries(rates)) {
        if (tenant.fxRates?.[currency] === rate) continue;
        const open = await tx.deal.find({ tenantId: ctx.tenantId, closedAt: null, currency }, { projection: { id: 1, amount: 1 } });
        for (const d of open) await tx.deal.update({ id: d.id }, { $set: { baseAmount: Math.round(d.amount * rate) } });
      }
      await this.audit.log(tx, { action: "currency.rates_updated", entityType: "tenant", entityId: ctx.tenantId, diff: rates });
      return currencyDto(updated);
    });
  }

  // ─── Document details ───────────────────────────────────────

  async docSettings(): Promise<DocSettings> {
    const { tenantId } = authedContext();
    return docSettingsDto(await this.db.scoped((tx) => tx.tenant.get({ id: tenantId }, { projection: { docSettings: 1 } })));
  }

  async updateDocSettings(input: DocSettingsInput): Promise<DocSettings> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const current = await tx.tenant.get({ id: ctx.tenantId }, { projection: { docSettings: 1 } });
      // The logo has its own endpoint and stays as it is
      const next = { ...docSettingsDto({ docSettings: { ...input, maxDiscountBp: input.maxDiscountBp ?? null } }), logo: current.docSettings?.logo ?? null };
      const updated = await tx.tenant.update({ id: ctx.tenantId }, { $set: { docSettings: next } });
      await this.audit.log(tx, { action: "documents.settings_updated", entityType: "tenant", entityId: ctx.tenantId });
      return docSettingsDto(updated);
    });
  }

  /** Sets (or with null removes) the logo printed on documents. */
  async updateLogo(dataUrl: string | null): Promise<DocSettings> {
    const ctx = authedContext();
    let logo: string | null = null;
    if (dataUrl) {
      const m = /^data:[a-z/+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      const bytes = m ? Buffer.from(m[1]!, "base64") : null;
      const type = bytes && LOGO_TYPES.find(([, is]) => is(bytes))?.[0];
      if (!bytes || !type) throw new AppError("VALIDATION_FAILED", "The logo must be a PNG, JPEG or WebP image", { logo: ["Unsupported image"] });
      if (bytes.length > LOGO_MAX_BYTES) throw new AppError("VALIDATION_FAILED", "The logo is too large", { logo: ["At most 200 KB"] });
      logo = `data:${type};base64,${bytes.toString("base64")}`;
    }
    return this.db.scoped(async (tx) => {
      const updated = await tx.tenant.update({ id: ctx.tenantId }, { $set: { "docSettings.logo": logo } as never });
      await this.audit.log(tx, { action: logo ? "documents.logo_updated" : "documents.logo_removed", entityType: "tenant", entityId: ctx.tenantId });
      return docSettingsDto(updated);
    });
  }
}

// Seller details on documents: a separate block of the company settings
export function docSettingsDto(tenant: Pick<Tenant, "docSettings">): DocSettings {
  const s = tenant.docSettings ?? {};
  return {
    legalName: s.legalName ?? null,
    taxId: s.taxId ?? null,
    address: s.address ?? null,
    bankDetails: s.bankDetails ?? null,
    terms: s.terms ?? null,
    maxDiscountBp: s.maxDiscountBp ?? null,
    orderSteps: s.orderSteps ?? [],
    contractTemplate: s.contractTemplate ?? null,
    logo: s.logo ?? null,
  };
}

/** The seller block printed on documents: only what a customer may see. */
export function docCompany(tenant: Pick<Tenant, "name" | "docSettings">): DocCompany {
  const s = docSettingsDto(tenant);
  return { name: tenant.name, legalName: s.legalName ?? null, taxId: s.taxId ?? null, address: s.address ?? null, bankDetails: s.bankDetails ?? null, terms: s.terms ?? null, logo: s.logo };
}

/** Image types accepted as a logo, by their first bytes (the declared type isn't trusted; SVG can carry scripts). */
const LOGO_TYPES: [string, (b: Buffer) => boolean][] = [
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
];

function currencyDto(tenant: Pick<Tenant, "currency" | "fxRates">): CurrencySettingsDto {
  const rates = { ...(tenant.fxRates ?? {}) };
  return { base: tenant.currency, rates, available: [tenant.currency, ...Object.keys(rates)] };
}

/** A pipeline with the default stages (signup and "new pipeline"). */
export async function insertPipeline(tx: Tx, tenantId: string, name: string, isDefault: boolean) {
  const pipeline = await tx.pipeline.insertOne({ tenantId, name, isDefault });
  await tx.pipelineStage.insertMany(DEFAULT_STAGES.map((s, order) => ({ ...s, order, tenantId, pipelineId: pipeline.id })));
  return pipeline;
}
