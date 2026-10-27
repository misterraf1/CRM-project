import type { InvoiceLineDto, MeResponse, SubscriptionStatus } from "@/shared";
import type { Dictionary } from "./i18n/dictionaries/az";
import { interpolate } from "./i18n/locales";

/** Cheapest plan that includes a feature (for "available in PRO" prompts). */
export const FEATURE_PLAN: Record<string, string> = {
  "inbox.omnichannel": "PRO",
  "deals.pipeline": "PRO",
  "team.monitoring": "PRO",
  "analytics.basic": "PRO",
  "analytics.advanced": "BUSINESS",
  automations: "BUSINESS",
  departments: "BUSINESS",
};

export const hasFeature = (me: MeResponse, feature: string) => me.subscription.features.includes(feature);

export function invoiceLineText(line: InvoiceLineDto, t: Dictionary) {
  const b = t.billing;
  const template = b.lines[line.code as keyof typeof b.lines] ?? line.code;
  return interpolate(template, {
    plan: line.plan ?? "",
    interval: line.interval ? b.intervals[line.interval] : "",
    n: line.quantity,
  });
}

/** Badge colours per subscription status (company billing page and platform console). */
export const SUBSCRIPTION_STATUS_STYLE: Record<SubscriptionStatus, string> = {
  TRIALING: "bg-accent-soft text-accent",
  ACTIVE: "bg-success/10 text-success",
  PAST_DUE: "bg-warning/10 text-warning",
  SUSPENDED: "bg-danger/10 text-danger",
  CANCELED: "bg-muted text-fg-subtle",
};

export const INVOICE_STATUS_STYLE: Record<string, string> = {
  PAID: "bg-success/10 text-success",
  FAILED: "bg-danger/10 text-danger",
};
