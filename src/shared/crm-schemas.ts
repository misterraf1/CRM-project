import { z } from "zod";
import { CURRENCIES, customFieldValuesSchema } from "./crm-settings";

export const LIFECYCLE_STAGES = ["LEAD", "QUALIFIED", "CUSTOMER", "CHURNED"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const CONTACT_SOURCES = ["manual", "website", "whatsapp", "instagram", "messenger", "facebook", "telegram", "ads", "phone", "referral", "other"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();

// E.164-ish: digits with optional leading +, spaces/dashes stripped
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => v === "" || /^\+?\d{7,15}$/.test(v), "Invalid phone number")
  .transform((v) => (v === "" ? null : v))
  .nullish();

const email = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "" || z.string().email().safeParse(v).success, "Invalid email")
  .transform((v) => (v === "" ? null : v))
  .nullish();

/** Amounts arrive in minor units (qəpik). Upper bound keeps us inside int4. */
const amount = z.coerce.number().int().min(0).max(2_000_000_000);

export const contactCreateSchema = z.object({
  type: z.enum(["person", "company"]).default("person"),
  name: z.string().trim().min(1).max(150),
  email,
  phone,
  companyName: optionalText(150),
  /** The company contact a person works at (sets companyName from it) */
  companyId: z.string().min(1).max(64).nullish(),
  stage: z.enum(LIFECYCLE_STAGES).default("LEAD"),
  source: z.enum(CONTACT_SOURCES).default("manual"),
  ownerId: z.string().min(1).max(64).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  customFields: customFieldValuesSchema.optional(),
});
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;

export const contactUpdateSchema = contactCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;

export const contactListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  stage: z.enum(LIFECYCLE_STAGES).optional(),
  ownerId: z.string().min(1).max(64).optional(),
  type: z.enum(["person", "company"]).optional(),
  source: z.enum(CONTACT_SOURCES).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  /** People of one company */
  companyId: z.string().min(1).max(64).optional(),
  /** Custom field filter: field id + value (text: contains; select/multiselect: has option; checkbox: "true"/"false") */
  field: z.string().min(1).max(64).optional(),
  value: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

export const noteSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export const dealCreateSchema = z.object({
  title: z.string().trim().min(1).max(150),
  amount: amount.default(0),
  pipelineId: z.string().min(1).max(64).optional(),
  stageId: z.string().min(1).max(64).optional(),
  contactId: z.string().min(1).max(64).nullish(),
  ownerId: z.string().min(1).max(64).nullish(),
  expectedClose: z.coerce.date().nullish(),
  /** Defaults to the company currency */
  currency: z.enum(CURRENCIES).optional(),
  customFields: customFieldValuesSchema.optional(),
});
export type DealCreateInput = z.infer<typeof dealCreateSchema>;

export const dealUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    amount,
    contactId: z.string().min(1).max(64).nullable(),
    ownerId: z.string().min(1).max(64).nullable(),
    expectedClose: z.coerce.date().nullable(),
    currency: z.enum(CURRENCIES),
    customFields: customFieldValuesSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type DealUpdateInput = z.infer<typeof dealUpdateSchema>;

export const LOST_REASONS = ["price", "competitor", "no_budget", "no_response", "timing", "other"] as const;

export const dealMoveSchema = z.object({
  stageId: z.string().min(1).max(64),
  /** Kanban ordering inside the target column; appended at the end when omitted */
  position: z.number().finite().optional(),
  lostReason: z.string().trim().min(1).max(200).optional(),
});
export type DealMoveInput = z.infer<typeof dealMoveSchema>;

export const dealListQuerySchema = z.object({
  pipelineId: z.string().min(1).max(64).optional(),
  ownerId: z.string().min(1).max(64).optional(),
  q: z.string().trim().max(100).optional(),
});
export type DealListQuery = z.infer<typeof dealListQuerySchema>;

export const DASHBOARD_PERIODS = ["7d", "30d", "90d"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
export const dashboardQuerySchema = z.object({ period: z.enum(DASHBOARD_PERIODS).default("30d") });

/** Possible duplicates while creating a contact (by email or phone). */
export const duplicateQuerySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).optional(),
  phone: z.string().trim().max(40).optional(),
  excludeId: z.string().max(64).optional(),
});
