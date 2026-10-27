import { z } from "zod";
import type { SubscriptionStatus } from "./api-types";
import { ALL_FEATURES, type BillingInterval, type InvoiceDto, type InvoiceKind, type InvoiceStatus } from "./billing";

// ─── Platform staff (Super Admin) ───────────────────────────────

export type PlatformRole = "SUPPORT" | "SUPER_ADMIN";

export const adminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export interface AdminTokens {
  accessToken: string;
  expiresAt: string;
}

/** Password was right, a 2FA code is still needed: answer with the challenge and a code. */
export interface AdminMfaChallenge {
  mfaRequired: true;
  /** Short-lived token proving the password step (5 minutes) */
  challenge: string;
}

export const adminMfaVerifySchema = z.object({
  challenge: z.string().min(10).max(2000),
  /** 6-digit authenticator code or a recovery code */
  code: z.string().trim().min(6).max(20),
});

export const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(20) });

export interface MfaSetupDto {
  /** Base32 key for manual entry */
  secret: string;
  otpauthUri: string;
  /** QR code of otpauthUri as an SVG document */
  qrSvg: string;
}

export interface MfaEnabledDto {
  /** Shown once; each works one time if the phone is lost */
  recoveryCodes: string[];
}

export interface AdminMe {
  id: string;
  fullName: string;
  email: string;
  role: PlatformRole;
  mfaEnabled: boolean;
  /** Staff must turn on 2FA before using the console (PLATFORM_REQUIRE_MFA) */
  mfaRequired: boolean;
  recoveryCodesLeft: number;
}

export interface MoneyMonth {
  /** First day of the month (UTC) */
  month: string;
  revenue: number;
  expenses: number;
}

export interface AdminOverviewDto {
  currency: string;
  /** Monthly recurring revenue: active + past-due subscriptions, yearly plans as 1/12 */
  mrr: number;
  arr: number;
  tenants: Record<SubscriptionStatus, number> & { total: number };
  signups30d: number;
  /** Subscriptions that ended (canceled) in the last 30 days */
  churned30d: number;
  /** churned30d / (paying now + churned30d), 0..1 */
  churnRate: number;
  revenue30d: number;
  expenses30d: number;
  profit30d: number;
  months: MoneyMonth[];
  failedPayments7d: number;
  openTickets: number;
}

export interface AdminTenantRow {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  plan: string;
  status: SubscriptionStatus;
  interval: BillingInterval;
  seats: { used: number; limit: number };
  /** Monthly-equivalent amount this tenant pays now (0 while trialing / suspended) */
  mrr: number;
  ownerEmail: string | null;
}

export interface AdminTenantListResponse {
  items: AdminTenantRow[];
  total: number;
}

export interface AdminTenantDetail extends AdminTenantRow {
  timezone: string;
  currency: string;
  subscription: {
    trialEndsAt: string | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    graceEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    scheduledPlan: string | null;
    extraSeats: number;
    extraStorageGb: number;
    paymentMethod: { brand: string; last4: string } | null;
  };
  usage: { contacts: number; deals: number; tasks: number; conversations: number; storageMb: { used: number; limit: number } };
  members: { id: string; fullName: string; email: string; role: string; status: string; lastLoginAt: string | null }[];
  invoices: InvoiceDto[];
  activity: { id: string; action: string; actor: string | null; createdAt: string }[];
}

export const adminTenantQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const extendTrialSchema = z.object({ days: z.number().int().min(1).max(60) });
export const suspendSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const planUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    priceMonthly: z.number().int().min(0).max(10_000_000),
    priceYearly: z.number().int().min(0).max(100_000_000),
    seatLimit: z.number().int().min(1).max(10_000),
    storageMb: z.number().int().min(100).max(10_000_000),
    extraSeatPrice: z.number().int().min(0).max(1_000_000),
    extraStorageGbPrice: z.number().int().min(0).max(1_000_000),
    aiCredits: z.number().int().min(0).max(1_000_000),
    features: z.array(z.enum(ALL_FEATURES as [string, ...string[]])).max(50),
    isPublic: z.boolean(),
  })
  .partial();
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;

export interface AdminPlanDto {
  code: string;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  seatLimit: number;
  storageMb: number;
  extraSeatPrice: number;
  extraStorageGbPrice: number;
  aiCredits: number;
  features: string[];
  isPublic: boolean;
  /** Tenants currently on this plan */
  tenants: number;
}

export interface AdminInvoiceRow {
  id: string;
  number: string;
  tenantId: string;
  company: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  amount: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  failureCode: string | null;
}

export const adminInvoiceQuerySchema = z.object({
  status: z.enum(["OPEN", "PAID", "FAILED", "VOID"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export interface AdminInvoiceListResponse {
  items: AdminInvoiceRow[];
  total: number;
  /** Sums over the filter (minor units) */
  totals: { paid: number; failed: number };
}

export const EXPENSE_CATEGORIES = ["server", "api", "ai", "sms", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  vendor: z.string().trim().min(2).max(80),
  amount: z.number().int().min(1).max(100_000_000),
  incurredOn: z.string().date(),
  note: z.string().trim().max(500).optional(),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

export interface ExpenseDto {
  id: string;
  category: ExpenseCategory;
  vendor: string;
  amount: number;
  currency: string;
  incurredOn: string;
  note: string | null;
}

export interface JobHealth {
  name: string;
  runs: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
}

export interface SystemHealthDto {
  db: { ok: boolean; latencyMs: number | null };
  uptimeSec: number;
  memoryMb: number;
  node: string;
  jobsEnabled: boolean;
  jobs: JobHealth[];
  webhooks: { received24h: number; failed24h: number; recentErrors: { id: string; provider: string; error: string; receivedAt: string }[] };
  channels: { connected: number; error: number; errors: { id: string; tenant: string; name: string; type: string }[] };
  billingProvider: string;
  /** AI models in fallback order, with their current state */
  ai: { provider: string; configured: boolean; models: { model: string; coolingUntil: string | null; lastError: string | null; lastOkAt: string | null }[] };
  mail: {
    /** SMTP_URL set; otherwise nothing is delivered */
    configured: boolean;
    queued: number;
    sent24h: number;
    failed24h: number;
    notSent24h: number;
    /** Latest messages — addresses and subjects only, never the body (reset links) */
    recent: { id: string; to: string; subject: string; template: string; status: string; error: string | null; createdAt: string }[];
  };
}

// ─── Support tickets (company ↔ platform) ───────────────────────

export const TICKET_STATUSES = ["open", "in_progress", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const ticketCreateSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(5).max(5000),
  priority: z.enum(TICKET_PRIORITIES).default("MEDIUM"),
});
export type TicketCreateInput = z.infer<typeof ticketCreateSchema>;

export const ticketMessageSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export const ticketUpdateSchema = z
  .object({ status: z.enum(TICKET_STATUSES), priority: z.enum(TICKET_PRIORITIES) })
  .partial()
  .refine((v) => v.status !== undefined || v.priority !== undefined, { message: "Nothing to update" });

export interface TicketMessageDto {
  id: string;
  body: string;
  /** Written by platform support (not by the company) */
  fromStaff: boolean;
  author: string;
  createdAt: string;
}

export interface TicketDto {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  author: string;
  createdAt: string;
  updatedAt: string;
  /** Platform view only */
  tenant?: { id: string; name: string; plan: string; prioritySupport: boolean };
  messages?: TicketMessageDto[];
  lastMessageFromStaff?: boolean;
}
