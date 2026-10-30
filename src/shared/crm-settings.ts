import { z } from "zod";

// Company-level CRM configuration: custom fields, pipelines and stages, currencies.

/** Currencies a deal can be in. The company's own currency needs no rate. */
export const CURRENCIES = ["AZN", "USD", "EUR", "RUB", "TRY", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** "contact" fields apply to people, "company" fields to companies (both are contacts). */
export const FIELD_ENTITIES = ["contact", "company", "deal"] as const;
export type FieldEntity = (typeof FIELD_ENTITIES)[number];

export const FIELD_TYPES = ["text", "number", "date", "select", "multiselect", "checkbox", "currency"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const option = z.string().trim().min(1).max(60);

export const fieldCreateSchema = z
  .object({
    entity: z.enum(FIELD_ENTITIES),
    label: z.string().trim().min(1).max(60),
    type: z.enum(FIELD_TYPES),
    options: z.array(option).max(50).default([]),
    required: z.boolean().default(false),
  })
  .refine((v) => !["select", "multiselect"].includes(v.type) || v.options.length > 0, { message: "Options required", path: ["options"] })
  .refine((v) => new Set(v.options).size === v.options.length, { message: "Duplicate option", path: ["options"] });
export type FieldCreateInput = z.infer<typeof fieldCreateSchema>;

/** The type and entity are fixed once a field exists (stored values depend on them). */
export const fieldUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    options: z.array(option).max(50),
    required: z.boolean(),
    archived: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" })
  .refine((v) => !v.options || new Set(v.options).size === v.options.length, { message: "Duplicate option", path: ["options"] });
export type FieldUpdateInput = z.infer<typeof fieldUpdateSchema>;

export const fieldReorderSchema = z.object({ entity: z.enum(FIELD_ENTITIES), ids: z.array(z.string().min(1).max(64)).min(1).max(200) });

export const fieldListQuerySchema = z.object({ entity: z.enum(FIELD_ENTITIES).optional(), archived: z.enum(["true", "false"]).optional() });

export interface FieldDefinitionDto {
  id: string;
  entity: FieldEntity;
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
  order: number;
  archived: boolean;
}

/** Custom field values by field id. Money ("currency") is in minor units of the company currency. */
export type CustomFieldValues = Record<string, string | number | boolean | string[] | null>;

export const customFieldValuesSchema = z
  .record(z.string().min(1).max(64), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.array(z.string().max(60)).max(50), z.null()]))
  .refine((v) => Object.keys(v).length <= 100, { message: "Too many fields" });

// ─── Pipelines ──────────────────────────────────────────────

export const STAGE_KINDS = ["open", "won", "lost"] as const;

const stageInput = z.object({
  /** Existing stage; omitted for a new one */
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(40),
  probability: z.number().int().min(0).max(100),
  kind: z.enum(STAGE_KINDS),
});

/** The full, ordered stage list: open stages, then exactly one won and one lost stage. */
export const stagesSchema = z
  .array(stageInput)
  .min(3)
  .max(20)
  .refine((s) => s.some((x) => x.kind === "open"), { message: "At least one open stage" })
  .refine((s) => s.filter((x) => x.kind === "won").length === 1 && s.filter((x) => x.kind === "lost").length === 1, {
    message: "Exactly one won and one lost stage",
  });
export type StageInput = z.infer<typeof stageInput>;

export const pipelineCreateSchema = z.object({ name: z.string().trim().min(1).max(60) });
export const pipelineUpdateSchema = z
  .object({ name: z.string().trim().min(1).max(60), isDefault: z.literal(true) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export const stagesReplaceSchema = z.object({ stages: stagesSchema });

// ─── Currencies ─────────────────────────────────────────────

/** Rates: how much of the company currency one unit of the other currency is worth. */
export const currencySettingsSchema = z.object({
  rates: z.record(z.enum(CURRENCIES), z.number().positive().max(1_000_000)).default({}),
});
export type CurrencySettingsInput = z.infer<typeof currencySettingsSchema>;

export interface CurrencySettingsDto {
  base: string;
  rates: Partial<Record<Currency, number>>;
  /** Currencies a deal may use: the base plus every currency with a rate */
  available: string[];
}
