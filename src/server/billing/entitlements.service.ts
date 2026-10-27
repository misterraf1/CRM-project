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

/** Plan limits and features. The trial unlocks every feature so all of it can be tried. */
export class EntitlementsService {
  features(sub: SubscriptionWithPlan): string[] {
    return sub.status === "TRIALING" ? [...ALL_FEATURES] : sub.plan.features;
  }

  async seats(tx: Tx, tenantId: string) {
    const [subscription, used] = await Promise.all([
      subscriptionOf(tx, tenantId),
      // Pending invites hold a seat so the limit can't be bypassed by mass-inviting
      tx.membership.count({ tenantId, status: { $in: ["ACTIVE", "INVITED"] } }),
    ]);
    return { used, limit: subscription.plan.seatLimit + subscription.extraSeats };
  }

  async storage(tx: Tx, tenantId: string) {
    const [subscription, usedBytes] = await Promise.all([subscriptionOf(tx, tenantId), storageUsed(tx, tenantId)]);
    return { used: Math.ceil(usedBytes / 1048576), limit: subscription.plan.storageMb + subscription.extraStorageMb };
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
