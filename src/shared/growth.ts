import { z } from "zod";
import { LIFECYCLE_STAGES } from "./crm-schemas";
import type { CaseStatus } from "./service";

// Bringing customers in and keeping in touch: website forms, email campaigns, the
// customer's own portal, and the catalog of integrations (live and planned).

// ─── Website forms ──────────────────────────────────────────

export const FORM_FIELD_KEYS = ["name", "email", "phone", "company", "message"] as const;
export type FormFieldKey = (typeof FORM_FIELD_KEYS)[number];

const id = z.string().min(1).max(64);

export const webFormSchema = z.object({
  name: z.string().trim().min(2).max(100),
  title: z.string().trim().min(2).max(150),
  fields: z
    .array(z.object({ key: z.enum(FORM_FIELD_KEYS), label: z.string().trim().min(1).max(80), required: z.boolean() }))
    .min(1)
    .max(FORM_FIELD_KEYS.length)
    .refine((f) => f.some((x) => x.key === "email" || x.key === "phone"), "A form needs an email or phone field")
    .refine((f) => new Set(f.map((x) => x.key)).size === f.length, "Each field once"),
  successMessage: z.string().trim().min(2).max(300),
  /** Rotate new leads through these members (empty = the company owner) */
  assigneeIds: z.array(id).max(50).default([]),
  /** Also open a deal in the default pipeline */
  createDeal: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type WebFormInput = z.infer<typeof webFormSchema>;

export const formSubmitSchema = z.object({
  values: z.record(z.enum(FORM_FIELD_KEYS), z.string().trim().max(2000)),
  /** Honeypot: people never fill it */
  website: z.string().max(200).optional(),
  /** Where the form was embedded (shown on the lead) */
  page: z.string().max(500).optional(),
});

export interface WebFormDto extends WebFormInput {
  id: string;
  /** Public key for the hosted page and the embed code */
  key: string;
  submissions: number;
  lastSubmissionAt: string | null;
}

export interface PublicFormDto {
  companyName: string;
  title: string;
  fields: WebFormInput["fields"];
  successMessage: string;
}

// ─── Email campaigns ──────────────────────────────────────────

export const segmentSchema = z
  .object({
    stage: z.enum(LIFECYCLE_STAGES).optional(),
    source: z.string().max(40).optional(),
    tag: z.string().trim().max(40).optional(),
    level: z.enum(["hot", "warm", "cold"]).optional(),
    activity: z.enum(["active", "passive"]).optional(),
    ownerId: id.optional(),
  })
  .strict();
export type Segment = z.infer<typeof segmentSchema>;

export const campaignSchema = z.object({
  name: z.string().trim().min(2).max(100),
  subject: z.string().trim().min(2).max(200),
  /** Plain text; {name} is the customer's name */
  body: z.string().trim().min(2).max(20_000),
  segment: segmentSchema.default({}),
});
export type CampaignInput = z.infer<typeof campaignSchema>;

/** Most recipients one campaign can reach */
export const CAMPAIGN_MAX_RECIPIENTS = 5000;
/** Deals won by recipients this long after sending count as the campaign's result */
export const CAMPAIGN_ATTRIBUTION_DAYS = 30;

export type CampaignStatus = "draft" | "sent";

export interface CampaignDto extends CampaignInput {
  id: string;
  status: CampaignStatus;
  sentAt: string | null;
  createdBy: string | null;
  stats: {
    recipients: number;
    /** Handed to the mail server */
    sent: number;
    failed: number;
    /** Waiting in the queue, or not sent because no mail server is set up */
    pending: number;
    unsubscribed: number;
    /** Won deals of recipients within the attribution window, company currency */
    wonDeals: number;
    revenue: number;
  };
}

export interface CampaignPreviewDto {
  /** Contacts matching the segment that can receive email */
  recipients: number;
  /** Matching but excluded: no email or unsubscribed */
  excluded: number;
  /** Without SMTP nothing is delivered */
  mailConfigured: boolean;
}

// ─── Customer portal ──────────────────────────────────────────

export interface PortalLinkDto {
  /** /c/<tenantId>.<secret> — shown once; only its hash is stored */
  path: string;
}

export const portalCaseSchema = z.object({
  subject: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).nullish(),
});

export interface PortalDto {
  company: { name: string; logo: string | null };
  customer: { name: string };
  docs: { id: string; kind: "quote" | "invoice"; number: string | null; status: string; total: number; paidAmount: number; currency: string; date: string; dueDate: string | null }[];
  orders: { id: string; number: string; title: string; status: string; progress: { done: number; total: number }; deliveryDate: string | null }[];
  cases: { id: string; number: string; subject: string; status: CaseStatus; createdAt: string }[];
  files: { id: string; name: string; createdAt: string }[];
}

// ─── Integrations ──────────────────────────────────────────

/**
 * What can be connected. "live" ones work today; "planned" ones have their place
 * (settings card, provider interface) and are added once the provider is approved.
 */
export const INTEGRATIONS = [
  { key: "whatsapp", status: "live", href: "/settings/channels" },
  { key: "instagram", status: "live", href: "/settings/channels" },
  { key: "messenger", status: "live", href: "/settings/channels" },
  { key: "telegram", status: "live", href: "/settings/channels" },
  { key: "email", status: "live", href: "/settings/channels" },
  { key: "webchat", status: "live", href: "/settings/channels" },
  { key: "forms", status: "live", href: "/settings/forms" },
  { key: "ai", status: "live", href: null },
  { key: "public_api", status: "planned", href: null },
  { key: "webhooks", status: "planned", href: null },
  { key: "google_calendar", status: "planned", href: null },
  { key: "voip", status: "planned", href: null },
  { key: "sms", status: "planned", href: null },
  { key: "speech", status: "planned", href: null },
  { key: "payments", status: "planned", href: null },
  { key: "accounting", status: "planned", href: null },
] as const;
export type IntegrationKey = (typeof INTEGRATIONS)[number]["key"];
