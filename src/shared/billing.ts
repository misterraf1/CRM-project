import { z } from "zod";
import type { SubscriptionStatus } from "./api-types";

/** Feature codes stored in Plan.features (editable by the platform owner). */
export const FEATURES = {
  crmBasic: "crm.basic",
  tasks: "tasks",
  teamChat: "team_chat",
  webchat: "inbox.webchat",
  omnichannel: "inbox.omnichannel",
  pipeline: "deals.pipeline",
  teamMonitoring: "team.monitoring",
  analyticsBasic: "analytics.basic",
  analyticsAdvanced: "analytics.advanced",
  automations: "automations",
  departments: "departments",
  prioritySupport: "support.priority",
} as const;
export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

export const ALL_FEATURES: readonly Feature[] = Object.values(FEATURES);

export const BILLING_INTERVALS = ["MONTH", "YEAR"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const checkoutSchema = z.object({
  planCode: z.string().trim().min(1).max(20),
  interval: z.enum(BILLING_INTERVALS).default("MONTH"),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const downgradeSchema = z.object({ planCode: z.string().trim().min(1).max(20) });

export const addonsSchema = z.object({
  extraSeats: z.number().int().min(0).max(500),
  extraStorageGb: z.number().int().min(0).max(1000),
});
export type AddonsInput = z.infer<typeof addonsSchema>;

/** Demo provider only: what happens on the hosted checkout page / the next automatic charge. */
export const demoCompleteSchema = z.object({ outcome: z.enum(["success", "declined"]) });
export const demoNextChargeSchema = z.object({ fails: z.boolean() });

export interface PlanDto {
  code: string;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  seatLimit: number;
  storageMb: number;
  features: string[];
  extraSeatPrice: number;
  extraStorageGbPrice: number;
  /** AI assistant requests per month */
  aiCredits: number;
  /** null = unlimited */
  contactLimit: number | null;
  automationLimit: number | null;
}

/** manual: a payment the platform recorded · gift: a period the platform gave for free */
export type InvoiceKind = "subscription" | "upgrade" | "renewal" | "addons" | "manual" | "gift";
export type InvoiceStatus = "DRAFT" | "OPEN" | "PAID" | "FAILED" | "VOID";

export interface InvoiceLineDto {
  /** plan | proration_credit | extra_seats | extra_storage */
  code: string;
  plan?: string;
  interval?: BillingInterval;
  quantity: number;
  unitAmount: number;
  amount: number;
}

export interface InvoiceDto {
  id: string;
  number: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  amount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  lines: InvoiceLineDto[];
  paidAt: string | null;
  createdAt: string;
  payments: { provider: string; status: string; failureCode: string | null; createdAt: string }[];
}

export interface BillingOverviewDto {
  /** "manual": the platform manages the subscription, the company has no checkout */
  provider: "demo" | "manual";
  subscription: {
    plan: PlanDto;
    status: SubscriptionStatus;
    interval: BillingInterval;
    trialEndsAt: string | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    graceEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    scheduledPlan: string | null;
    extraSeats: number;
    extraStorageGb: number;
    paymentMethod: { brand: string; last4: string } | null;
    /** Demo provider: the next automatic charge will be declined */
    demoNextChargeFails: boolean;
  };
  usage: {
    seats: { used: number; limit: number };
    storageMb: { used: number; limit: number };
    /** limit null = unlimited */
    contacts: { used: number; limit: number | null };
    automations: { used: number; limit: number | null };
  };
  /** Features in effect: the plan's plus any granted by the platform (all of them during the trial) */
  features: string[];
  plans: PlanDto[];
  invoices: InvoiceDto[];
  company: { name: string };
}

export interface CheckoutResponse {
  invoice: InvoiceDto;
  /** Hosted payment page (demo: our own page, clearly labelled) */
  redirectUrl: string;
}
