import type { ActivityDto, ActivityType } from "@/shared";
import { currentContext } from "../common/context";
import type { Tx } from "../db/database";
import type { Activity } from "../db/models";
import type { Sort } from "../db/repo";
import { memberRefs } from "./scope";

/** Newest first; id breaks ties between rows written in the same millisecond. */
export const TIMELINE_ORDER: Sort = { createdAt: -1, id: -1 };

/** CRM timeline: one row per meaningful event, shown on contact/deal pages and the dashboard. */
export class ActivityService {
  // Events written in one request (stage change → won → contact promoted) must keep
  // their order on the timeline, so timestamps are strictly increasing per process.
  private lastAt = 0;

  /** Wired by the container: timeline events that are automation triggers (quote accepted, invoice paid…) */
  onRecorded?: (tx: Tx, tenantId: string, entry: { type: ActivityType; payload: Record<string, unknown> }) => Promise<void>;

  private nextTimestamp() {
    this.lastAt = Math.max(Date.now(), this.lastAt + 1);
    return new Date(this.lastAt);
  }

  async record(
    tx: Tx,
    /** `tenantId` for background work (automations), which has no request context */
    entry: { type: ActivityType; contactId?: string | null; dealId?: string | null; payload: Record<string, unknown>; tenantId?: string },
  ) {
    const ctx = currentContext();
    const row = await tx.activity.insertOne({
      tenantId: entry.tenantId ?? ctx.tenantId!,
      actorId: ctx.membershipId ?? null,
      type: entry.type,
      contactId: entry.contactId ?? null,
      dealId: entry.dealId ?? null,
      payload: entry.payload as Activity["payload"],
      createdAt: this.nextTimestamp(),
    });
    // The contact is active again: passive lists, scoring and contact.inactive start over
    if (entry.contactId) await tx.contact.updateMany({ id: entry.contactId, tenantId: row.tenantId }, { $set: { lastActivityAt: row.createdAt, inactiveAlertedAt: null, scoredAt: null } });
    await this.onRecorded?.(tx, row.tenantId, entry);
    return row;
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
