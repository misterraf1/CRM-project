import { Injectable } from "@nestjs/common";
import { ALL_FEATURES } from "@axis/shared";
import type { Plan, Subscription } from "@prisma/client";
import { AppError } from "../common/errors";
import type { Tx } from "../prisma/prisma.service";

/** Statuses in which the workspace is read-only (writes answer SUBSCRIPTION_INACTIVE). */
export const INACTIVE_STATUSES = new Set(["SUSPENDED", "CANCELED"]);

/** Plan limits and features. The trial unlocks every feature so all of it can be tried. */
@Injectable()
export class EntitlementsService {
  features(sub: Subscription & { plan: Plan }): string[] {
    return sub.status === "TRIALING" ? [...ALL_FEATURES] : sub.plan.features;
  }

  async seats(tx: Tx, tenantId: string) {
    const [subscription, used] = await Promise.all([
      tx.subscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } }),
      // Pending invites hold a seat so the limit can't be bypassed by mass-inviting
      tx.membership.count({ where: { tenantId, status: { in: ["ACTIVE", "INVITED"] } } }),
    ]);
    return { used, limit: subscription.plan.seatLimit + subscription.extraSeats };
  }

  async storage(tx: Tx, tenantId: string) {
    const [subscription, files] = await Promise.all([
      tx.subscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } }),
      tx.fileObject.aggregate({ where: { tenantId }, _sum: { sizeBytes: true } }),
    ]);
    return { used: Math.ceil((files._sum.sizeBytes ?? 0) / 1048576), limit: subscription.plan.storageMb + subscription.extraStorageMb };
  }

  async assertSeatAvailable(tx: Tx, tenantId: string) {
    const { used, limit } = await this.seats(tx, tenantId);
    if (used >= limit) {
      throw new AppError("SEAT_LIMIT", `Seat limit reached (${used}/${limit})`, { used, limit });
    }
  }
}
