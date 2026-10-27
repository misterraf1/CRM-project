import type { NotificationDto, NotificationListResponse, NotificationType, ShellSummaryDto } from "@/shared";
import { authedContext } from "../common/context";
import { notFound } from "../common/errors";
import { unreadChatTotal } from "../chat/unread";
import { inboxScope } from "../inbox/inbox.service";
import type { Database, Tx } from "../db/database";
import type { Notification } from "../db/models";

export class NotificationsService {
  constructor(private readonly db: Database) {}

  /** In-app notifications, written in the caller's transaction. The actor is never notified of their own action. */
  async notify(
    tx: Tx,
    tenantId: string,
    recipients: (string | null | undefined)[],
    type: NotificationType,
    payload: Record<string, unknown>,
    exceptMemberId?: string,
  ) {
    const memberIds = [...new Set(recipients.filter((id): id is string => !!id && id !== exceptMemberId))];
    if (!memberIds.length) return;
    await tx.notification.insertMany(memberIds.map((memberId) => ({ tenantId, memberId, type, payload: payload as Notification["payload"] })));
  }

  async list(): Promise<NotificationListResponse> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const where = { tenantId: ctx.tenantId, memberId: ctx.membershipId };
      const [rows, unread] = await Promise.all([
        tx.notification.find(where, { sort: { createdAt: -1, id: -1 }, limit: 30 }),
        tx.notification.count({ ...where, readAt: null }),
      ]);
      return {
        unread,
        items: rows.map(
          (n): NotificationDto => ({
            id: n.id,
            type: n.type as NotificationType,
            payload: n.payload as NotificationDto["payload"],
            readAt: n.readAt?.toISOString() ?? null,
            createdAt: n.createdAt.toISOString(),
          }),
        ),
      };
    });
  }

  async markRead(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const res = await tx.notification.updateMany({ id, tenantId: ctx.tenantId, memberId: ctx.membershipId, readAt: null }, { $set: { readAt: new Date() } });
      if (!res.count && !(await tx.notification.count({ id, memberId: ctx.membershipId }))) throw notFound("Notification");
    });
  }

  async markAllRead() {
    const ctx = authedContext();
    await this.db.scoped((tx) => tx.notification.updateMany({ tenantId: ctx.tenantId, memberId: ctx.membershipId, readAt: null }, { $set: { readAt: new Date() } }));
  }

  /** Counters for the app shell (sidebar badge, bell). */
  async summary(): Promise<ShellSummaryDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const [overdueTasks, unreadNotifications, awaitingConversations, unreadChat] = await Promise.all([
        tx.task.count({ tenantId: ctx.tenantId, assigneeId: ctx.membershipId, status: { $nin: ["DONE", "CANCELED"] }, dueAt: { $lt: new Date(), $ne: null } }),
        tx.notification.count({ tenantId: ctx.tenantId, memberId: ctx.membershipId, readAt: null }),
        inboxScope(tx, ctx).then((scoped) =>
          tx.conversation.count({ $and: [{ tenantId: ctx.tenantId, awaitingSince: { $ne: null }, status: { $ne: "RESOLVED" } }, scoped] }),
        ),
        unreadChatTotal(tx, ctx),
      ]);
      return { overdueTasks, unreadNotifications, awaitingConversations, unreadChat };
    });
  }
}
