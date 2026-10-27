import type { BillingInterval } from "@axis/shared";
import type { Plan } from "@prisma/client";

const DAY = 86_400_000;

/** Yearly prices are stored on the plan; add-ons bill yearly at 10 months (same discount). */
export const ADDON_YEAR_MONTHS = 10;

export function planPrice(plan: Pick<Plan, "priceMonthly" | "priceYearly">, interval: BillingInterval) {
  return interval === "YEAR" ? plan.priceYearly : plan.priceMonthly;
}

export function addonsPrice(plan: Pick<Plan, "extraSeatPrice" | "extraStorageGbPrice">, extraSeats: number, extraStorageGb: number, interval: BillingInterval) {
  const monthly = extraSeats * plan.extraSeatPrice + extraStorageGb * plan.extraStorageGbPrice;
  return interval === "YEAR" ? monthly * ADDON_YEAR_MONTHS : monthly;
}

export function addInterval(from: Date, interval: BillingInterval) {
  const d = new Date(from);
  if (interval === "YEAR") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Share of the current period still ahead (0..1), for proration. */
export function remainingFraction(start: Date, end: Date, now = new Date()) {
  const total = end.getTime() - start.getTime();
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (end.getTime() - now.getTime()) / total));
}

export const days = (n: number) => n * DAY;

export const storageGb = (mb: number) => Math.round(mb / 1024);
