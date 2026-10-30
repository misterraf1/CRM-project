import { ALL_FEATURES } from "@/shared";
import { AppError } from "../common/errors";
import type { Tx } from "../db/database";
import type { Plan, Subscription } from "../db/models";

/** Statuses in which the workspace is read-only (writes answer SUBSCRIPTION_INACTIVE). */
export const INACTIVE_STATUSES = new Set(["SUSPENDED", "CANCELED"]);

export type SubscriptionWithPlan = Subscription & { plan: Plan };

// Plans are a handful of platform-wide rows read on every request (auth guard) and
// change only from the platform console, which drops this cache.
const PLAN_TTL_MS = 60_000;
const plans = new Map<string, { plan: Plan; until: number }>();

export function invalidatePlans() {
  plans.clear();
}

async function planOf(tx: Tx, id: string): Promise<Plan> {
  const hit = plans.get(id);
  if (hit && hit.until > Date.now()) return hit.plan;
  const plan = await tx.plan.get({ id });
  plans.set(id, { plan, until: Date.now() + PLAN_TTL_MS });
  return plan;
}

/** The tenant's subscription with its plan (404 if missing). */
export async function subscriptionOf(tx: Tx, tenantId: string): Promise<SubscriptionWithPlan> {
  const sub = await tx.subscription.get({ tenantId });
  return { ...sub, plan: await planOf(tx, sub.planId) };
}

export interface Limits {
  /** Plan (or company override) plus purchased extra seats */
  seats: number;
  storageMb: number;
  aiCredits: number;
  /** null = unlimited */
  contacts: number | null;
  automations: number | null;
}

/**
 * Limits in effect: the platform's per-company override wins over the plan; purchased
 * add-ons come on top. Subscriptions from before overrides existed have none.
 */
export function limitsOf(sub: SubscriptionWithPlan): Limits {
  const o = sub.limitOverrides ?? {};
  const pick = <K extends "contactLimit" | "automationLimit">(key: K) => (o[key] !== undefined ? o[key]! : (sub.plan[key] ?? null));
  return {
    seats: (o.seatLimit ?? sub.plan.seatLimit) + sub.extraSeats,
    storageMb: (o.storageMb ?? sub.plan.storageMb) + sub.extraStorageMb,
    aiCredits: o.aiCredits ?? sub.plan.aiCredits,
    contacts: pick("contactLimit"),
    automations: pick("automationLimit"),
  };
}

/** Features granted on top of the plan that haven't run out. */
export function activeGrants(sub: Pick<Subscription, "featureGrants">, now = new Date()) {
  return (sub.featureGrants ?? []).filter((g) => !g.until || g.until > now).map((g) => g.feature);
}

export type CountedResource = "contacts" | "automations";

/** Plan limits and features. The trial unlocks every feature so all of it can be tried. */
export class EntitlementsService {
  features(sub: SubscriptionWithPlan): string[] {
    if (sub.status === "TRIALING") return [...ALL_FEATURES];
    return [...new Set([...sub.plan.features, ...activeGrants(sub)])];
  }

  async seats(tx: Tx, tenantId: string) {
    const [subscription, used] = await Promise.all([
      subscriptionOf(tx, tenantId),
      // Pending invites hold a seat so the limit can't be bypassed by mass-inviting
      tx.membership.count({ tenantId, status: { $in: ["ACTIVE", "INVITED"] } }),
    ]);
    return { used, limit: limitsOf(subscription).seats };
  }

  async storage(tx: Tx, tenantId: string) {
    const [subscription, usedBytes] = await Promise.all([subscriptionOf(tx, tenantId), storageUsed(tx, tenantId)]);
    return { used: Math.ceil(usedBytes / 1048576), limit: limitsOf(subscription).storageMb };
  }

  /** How many contacts (people + companies) or automation rules a tenant has, against its limit. */
  async usage(tx: Tx, tenantId: string, resource: CountedResource) {
    const [subscription, used] = await Promise.all([
      subscriptionOf(tx, tenantId),
      resource === "contacts" ? tx.contact.count({ tenantId, deletedAt: null }) : tx.automationRule.count({ tenantId }),
    ]);
    return { used, limit: limitsOf(subscription)[resource] };
  }

  /** Throws PLAN_LIMIT when adding `adding` records would go over the limit. */
  async assertCapacity(tx: Tx, tenantId: string, resource: CountedResource, adding = 1) {
    const { used, limit } = await this.usage(tx, tenantId, resource);
    if (limit !== null && used + adding > limit) {
      throw new AppError("PLAN_LIMIT", `The ${resource} limit of the plan is reached (${used}/${limit})`, { resource, used, limit, adding });
    }
  }

  async assertSeatAvailable(tx: Tx, tenantId: string) {
    const { used, limit } = await this.seats(tx, tenantId);
    if (used >= limit) {
      throw new AppError("SEAT_LIMIT", `Seat limit reached (${used}/${limit})`, { used, limit });
    }
  }
}

/** Bytes of all stored files of a tenant. */
export async function storageUsed(tx: Tx, tenantId: string): Promise<number> {
  const [row] = await tx.fileObject.aggregate<{ total: number }>([{ $match: { tenantId } }, { $group: { _id: null, total: { $sum: "$sizeBytes" } } }]);
  return row?.total ?? 0;
}
