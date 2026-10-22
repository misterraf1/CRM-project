import type { InvoiceLineDto, MeResponse } from "@axis/shared";
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
