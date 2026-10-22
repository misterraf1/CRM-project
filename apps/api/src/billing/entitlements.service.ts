import { Injectable } from "@nestjs/common";
import { AppError } from "../common/errors";
import type { Tx } from "../prisma/prisma.service";

/** Plan limits. Grows into the full entitlement service with billing (Phase 6). */
@Injectable()
export class EntitlementsService {
  async seats(tx: Tx, tenantId: string) {
    const [subscription, used] = await Promise.all([
      tx.subscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } }),
      // Pending invites hold a seat so the limit can't be bypassed by mass-inviting
      tx.membership.count({ where: { tenantId, status: { in: ["ACTIVE", "INVITED"] } } }),
    ]);
    return { used, limit: subscription.plan.seatLimit + subscription.extraSeats };
  }

  async assertSeatAvailable(tx: Tx, tenantId: string) {
    const { used, limit } = await this.seats(tx, tenantId);
    if (used >= limit) {
      throw new AppError("SEAT_LIMIT", `Seat limit reached (${used}/${limit})`, { used, limit });
    }
  }
}
