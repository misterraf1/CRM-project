import { Injectable } from "@nestjs/common";
import type { Activity, Prisma } from "@prisma/client";
import type { ActivityDto, ActivityType } from "@axis/shared";
import { currentContext } from "../common/context";
import type { Tx } from "../prisma/prisma.service";
import { memberRefs } from "./scope";

/** Newest first; id breaks ties between rows written in the same millisecond. */
export const TIMELINE_ORDER = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/** CRM timeline: one row per meaningful event, shown on contact/deal pages and the dashboard. */
@Injectable()
export class ActivityService {
  // Events written in one request (stage change → won → contact promoted) must keep
  // their order on the timeline, so timestamps are strictly increasing per process.
  private lastAt = 0;

  private nextTimestamp() {
    this.lastAt = Math.max(Date.now(), this.lastAt + 1);
    return new Date(this.lastAt);
  }

  async record(
    tx: Tx,
    entry: { type: ActivityType; contactId?: string | null; dealId?: string | null; payload: Prisma.InputJsonObject },
  ) {
    const ctx = currentContext();
    return tx.activity.create({
      data: {
        tenantId: ctx.tenantId!,
        actorId: ctx.membershipId ?? null,
        type: entry.type,
        contactId: entry.contactId ?? null,
        dealId: entry.dealId ?? null,
        payload: entry.payload,
        createdAt: this.nextTimestamp(),
      },
    });
  }

  async toDtos(tx: Tx, tenantId: string, rows: Activity[]): Promise<ActivityDto[]> {
    const refs = await memberRefs(tx, tenantId, rows.map((r) => r.actorId));
    return rows.map((r) => {
      const actor = r.actorId ? refs.get(r.actorId) : undefined;
      return {
        id: r.id,
        type: r.type as ActivityType,
        contactId: r.contactId,
        dealId: r.dealId,
        actor: actor ? { id: actor.id, name: actor.name } : null,
        payload: (r.payload ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
