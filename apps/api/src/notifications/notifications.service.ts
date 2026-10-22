import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { NotificationDto, NotificationListResponse, NotificationType, ShellSummaryDto } from "@axis/shared";
import { authedContext } from "../common/context";
import { notFound } from "../common/errors";
import { inboxScope } from "../inbox/inbox.service";
import { PrismaService, type Tx } from "../prisma/prisma.service";

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** In-app notifications, written in the caller's transaction. The actor is never notified of their own action. */
  async notify(
    tx: Tx,
    tenantId: string,
    recipients: (string | null | undefined)[],
    type: NotificationType,
    payload: Prisma.InputJsonObject,
    exceptMemberId?: string,
  ) {
    const memberIds = [...new Set(recipients.filter((id): id is string => !!id && id !== exceptMemberId))];
    if (!memberIds.length) return;
    await tx.notification.createMany({ data: memberIds.map((memberId) => ({ tenantId, memberId, type, payload })) });
  }

  async list(): Promise<NotificationListResponse> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const where = { tenantId: ctx.tenantId, memberId: ctx.membershipId };
      const [rows, unread] = await Promise.all([
        tx.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30 }),
        tx.notification.count({ where: { ...where, readAt: null } }),
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
    await this.prisma.scoped(async (tx) => {
      const res = await tx.notification.updateMany({
        where: { id, tenantId: ctx.tenantId, memberId: ctx.membershipId, readAt: null },
        data: { readAt: new Date() },
      });
      if (!res.count && !(await tx.notification.count({ where: { id, memberId: ctx.membershipId } }))) throw notFound("Notification");
    });
  }

  async markAllRead() {
    const ctx = authedContext();
    await this.prisma.scoped((tx) =>
      tx.notification.updateMany({ where: { tenantId: ctx.tenantId, memberId: ctx.membershipId, readAt: null }, data: { readAt: new Date() } }),
    );
  }

  /** Counters for the app shell (sidebar badge, bell). */
  async summary(): Promise<ShellSummaryDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const scoped = await inboxScope(tx, ctx);
      const [overdueTasks, unreadNotifications, awaitingConversations] = await Promise.all([
        tx.task.count({
          where: { tenantId: ctx.tenantId, assigneeId: ctx.membershipId, status: { notIn: ["DONE", "CANCELED"] }, dueAt: { lt: new Date() } },
        }),
        tx.notification.count({ where: { tenantId: ctx.tenantId, memberId: ctx.membershipId, readAt: null } }),
        tx.conversation.count({ where: { AND: [{ tenantId: ctx.tenantId, awaitingSince: { not: null }, status: { not: "RESOLVED" } }, scoped] } }),
      ]);
      return { overdueTasks, unreadNotifications, awaitingConversations };
    });
  }
}
