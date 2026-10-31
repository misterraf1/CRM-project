import { z } from "zod";
import type { MemberRefDto } from "./crm-types";
import { PRIORITIES, type TaskPriority } from "./task-schemas";

// After the sale: customer complaints and service requests (with warranty), renewals of
// recurring services, sales targets, and the rule-based lead score.

// ─── Service cases ──────────────────────────────────────────

export const CASE_TYPES = ["complaint", "warranty", "question", "return"] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Resolution target by priority, in hours */
export const CASE_SLA_HOURS: Record<TaskPriority, number> = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 168 };

const id = z.string().min(1).max(64);

export const caseCreateSchema = z.object({
  contactId: id,
  dealId: id.nullish(),
  orderId: id.nullish(),
  type: z.enum(CASE_TYPES).default("complaint"),
  subject: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).nullish(),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  assigneeId: id.nullish(),
});
export type CaseCreateInput = z.infer<typeof caseCreateSchema>;

export const caseUpdateSchema = z
  .object({
    status: z.enum(CASE_STATUSES),
    priority: z.enum(PRIORITIES),
    assigneeId: id.nullable(),
    subject: z.string().trim().min(2).max(200),
    resolution: z.string().trim().max(5000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export const caseNoteSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export const caseListQuerySchema = z.object({
  status: z.enum([...CASE_STATUSES, "active", "overdue"]).optional(),
  contactId: id.optional(),
  mine: z.enum(["true", "false"]).optional(),
});

export interface CaseSummaryDto {
  id: string;
  number: string;
  subject: string;
  type: CaseType;
  status: CaseStatus;
  priority: TaskPriority;
  contact: { id: string; name: string };
  assignee: MemberRefDto | null;
  dueAt: string;
  overdue: boolean;
  createdAt: string;
}

export interface CaseDto extends CaseSummaryDto {
  description: string | null;
  deal: { id: string; title: string } | null;
  order: { id: string; number: string; title: string } | null;
  warranty: { until: string; valid: boolean } | null;
  resolution: string | null;
  resolvedAt: string | null;
  notes: { id: string; author: MemberRefDto | null; body: string; at: string }[];
  canEdit: boolean;
}

// ─── Renewals ──────────────────────────────────────────

export const RENEWAL_STATUSES = ["upcoming", "renewed", "lost"] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

/** Days before the due date when the owner gets a renewal task */
export const RENEWAL_LEAD_DAYS = 14;

export const renewalUpdateSchema = z.object({ status: z.enum(RENEWAL_STATUSES) });

export interface RenewalDto {
  id: string;
  contact: { id: string; name: string };
  productName: string;
  amount: number;
  currency: string;
  dueAt: string;
  status: RenewalStatus;
  owner: MemberRefDto | null;
  overdue: boolean;
  docId: string;
}

/** Contact card: what this customer has bought */
export interface CustomerValueDto {
  currency: string;
  /** Paid invoices, company currency, minor units */
  totalPaid: number;
  invoices: number;
  lastPurchaseAt: string | null;
  upcomingRenewals: RenewalDto[];
}

// ─── Sales targets ──────────────────────────────────────────

export const TARGET_PERIODS = ["month", "quarter"] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];

export const targetSchema = z.object({
  /** null = the whole company */
  memberId: id.nullable(),
  period: z.enum(TARGET_PERIODS),
  /** "YYYY-MM": first month of the period */
  start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /** Company currency, minor units */
  amount: z.number().int().min(1).max(1_000_000_000_000),
});
export type TargetInput = z.infer<typeof targetSchema>;

export const targetQuerySchema = z.object({ period: z.enum(TARGET_PERIODS).default("month"), start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

export interface TargetProgressDto {
  id: string | null;
  member: MemberRefDto | null;
  period: TargetPeriod;
  start: string;
  amount: number;
  /** Won deals in the period, company currency */
  achieved: number;
  wonDeals: number;
  /** 0–100+ */
  percent: number;
}

export interface TargetsDto {
  period: TargetPeriod;
  start: string;
  currency: string;
  /** Company target first (if set), then members */
  rows: TargetProgressDto[];
  canManage: boolean;
}

// ─── Lead score ──────────────────────────────────────────

export const SCORE_REASONS = [
  "reachable",
  "active_3d",
  "active_14d",
  "quiet_60d",
  "wrote_7d",
  "open_deal",
  "big_deal",
  "quote_open",
  "quote_accepted",
  "customer",
  "repeat_buyer",
] as const;
export type ScoreReason = (typeof SCORE_REASONS)[number];

const POINTS: Record<ScoreReason, number> = {
  reachable: 10,
  active_3d: 25,
  active_14d: 10,
  quiet_60d: -15,
  wrote_7d: 15,
  open_deal: 20,
  big_deal: 10,
  quote_open: 15,
  quote_accepted: 10,
  customer: 10,
  repeat_buyer: 10,
};

export type ScoreLevel = "hot" | "warm" | "cold";

export interface ScoreFacts {
  hasEmailOrPhone: boolean;
  /** Days since the last activity (null = never) */
  daysSinceActivity: number | null;
  wroteWithin7Days: boolean;
  openDeals: number;
  /** Largest open deal, company currency minor units */
  largestOpenDeal: number;
  openQuotes: number;
  acceptedQuotes: number;
  isCustomer: boolean;
  paidInvoices: number;
}

/** Big deal threshold: 5 000 in the company currency */
const BIG_DEAL = 500_000;

/** Rule-based score 0–100 with the reasons behind it (shown to the user). */
export function leadScore(f: ScoreFacts): { score: number; level: ScoreLevel; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = [];
  if (f.hasEmailOrPhone) reasons.push("reachable");
  if (f.daysSinceActivity !== null && f.daysSinceActivity <= 3) reasons.push("active_3d");
  else if (f.daysSinceActivity !== null && f.daysSinceActivity <= 14) reasons.push("active_14d");
  else if (f.daysSinceActivity === null || f.daysSinceActivity > 60) reasons.push("quiet_60d");
  if (f.wroteWithin7Days) reasons.push("wrote_7d");
  if (f.openDeals > 0) reasons.push("open_deal");
  if (f.largestOpenDeal >= BIG_DEAL) reasons.push("big_deal");
  if (f.openQuotes > 0) reasons.push("quote_open");
  if (f.acceptedQuotes > 0) reasons.push("quote_accepted");
  if (f.isCustomer) reasons.push("customer");
  if (f.paidInvoices >= 2) reasons.push("repeat_buyer");
  const score = Math.max(0, Math.min(100, reasons.reduce((a, r) => a + POINTS[r], 0)));
  return { score, level: score >= 60 ? "hot" : score >= 30 ? "warm" : "cold", reasons };
}

export const scorePoints = (r: ScoreReason) => POINTS[r];
