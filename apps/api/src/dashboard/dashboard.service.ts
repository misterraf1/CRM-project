import { Injectable } from "@nestjs/common";
import type { DashboardCrmDto, DashboardPeriod } from "@axis/shared";
import { authedContext } from "../common/context";
import { addDays, startOfDay } from "../common/time";
import { ActivityService, TIMELINE_ORDER } from "../crm/activity.service";
import { memberRefs, ownerScope } from "../crm/scope";
import { PrismaService } from "../prisma/prisma.service";
import { computeInboxMetrics, inboxScope } from "../inbox/inbox.service";
import { taskScope } from "../tasks/tasks.service";

const DAYS: Record<DashboardPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /** Real CRM figures for the dashboard, narrowed to what the caller may see. */
  async crm(period: DashboardPeriod): Promise<DashboardCrmDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true, currency: true } });
      const tz = tenant.timezone;
      const now = new Date();
      const days = DAYS[period];
      // Period = the last N calendar days including today, in the tenant's time zone
      const start = addDays(startOfDay(now, tz), -(days - 1), tz);
      const prevStart = addDays(start, -days, tz);
      const { scope, memberIds, where: scoped } = await ownerScope(tx, ctx, "dashboard.view_all");
      const base = { tenantId: ctx.tenantId };

      const [newContacts, prevContacts, openDeals, won, prevWon] = await Promise.all([
        tx.contact.count({ where: { AND: [base, scoped, { deletedAt: null, createdAt: { gte: start } }] } }),
        tx.contact.count({ where: { AND: [base, scoped, { deletedAt: null, createdAt: { gte: prevStart, lt: start } }] } }),
        tx.deal.aggregate({ where: { AND: [base, scoped, { stage: { kind: "open" } }] }, _count: true, _sum: { amount: true } }),
        tx.deal.findMany({
          where: { AND: [base, scoped, { stage: { kind: "won" }, closedAt: { gte: start } }] },
          select: { amount: true, closedAt: true, ownerId: true },
        }),
        tx.deal.aggregate({ where: { AND: [base, scoped, { stage: { kind: "won" }, closedAt: { gte: prevStart, lt: start } }] }, _sum: { amount: true } }),
      ]);

      // Revenue buckets: daily up to 30 days, weekly beyond
      const bucket = days > 30 ? "week" : "day";
      const step = bucket === "week" ? 7 : 1;
      const points: DashboardCrmDto["revenue"]["points"] = [];
      for (let offset = 0; offset < days; offset += step) {
        points.push({ date: addDays(start, offset, tz).toISOString(), amount: 0, deals: 0 });
      }
      for (const d of won) {
        const idx = Math.min(points.length - 1, Math.floor((d.closedAt!.getTime() - start.getTime()) / (step * 86_400_000)));
        points[idx]!.amount += d.amount;
        points[idx]!.deals += 1;
      }

      // Team: everyone in scope, even with zero sales, so managers see who is idle
      const members = await tx.membership.findMany({
        where: { tenantId: ctx.tenantId, status: "ACTIVE", ...(memberIds ? { id: { in: memberIds } } : {}) },
        select: { id: true },
      });
      const ids = members.map((m) => m.id);
      const openTask = { tenantId: ctx.tenantId, parentId: null, status: { notIn: ["DONE", "CANCELED"] as ("DONE" | "CANCELED")[] } };
      const { where: taskWhere } = await taskScope(tx, ctx);
      const [refs, doneByMember, overdueByMember, openTasks, overdueTasks, overdueItems] = await Promise.all([
        memberRefs(tx, ctx.tenantId, ids),
        tx.task.groupBy({ by: ["assigneeId"], where: { tenantId: ctx.tenantId, parentId: null, status: "DONE", assigneeId: { in: ids }, completedAt: { gte: start } }, _count: true }),
        tx.task.groupBy({ by: ["assigneeId"], where: { ...openTask, assigneeId: { in: ids }, dueAt: { lt: now } }, _count: true }),
        tx.task.count({ where: { AND: [openTask, taskWhere] } }),
        tx.task.count({ where: { AND: [openTask, taskWhere, { dueAt: { lt: now } }] } }),
        tx.task.findMany({
          where: { AND: [openTask, taskWhere, { dueAt: { lt: now } }] },
          orderBy: { dueAt: "asc" },
          take: 5,
          select: { id: true, title: true, dueAt: true, priority: true, assigneeId: true },
        }),
      ]);
      const [inbox, waiting] = await Promise.all([
        computeInboxMetrics(tx, ctx, start),
        tx.conversation.findMany({
          where: { AND: [{ tenantId: ctx.tenantId, awaitingSince: { not: null }, status: { not: "RESOLVED" } }, await inboxScope(tx, ctx)] },
          orderBy: { awaitingSince: "asc" },
          take: 5,
          include: {
            channel: { select: { type: true } },
            contact: { select: { name: true } },
            messages: { where: { direction: "INBOUND" }, orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
          },
        }),
      ]);
      const assigneeRefs = await memberRefs(tx, ctx.tenantId, [...overdueItems.map((t) => t.assigneeId), ...waiting.map((c) => c.assigneeId)]);
      const responseBy = new Map(inbox.byMember.map((m) => [m.member.id, m.avgFirstResponseMin]));
      const team = members.map((m) => {
        const mine = won.filter((d) => d.ownerId === m.id);
        const ref = refs.get(m.id)!;
        return {
          member: ref,
          dealsWon: mine.length,
          revenue: mine.reduce((a, d) => a + d.amount, 0),
          tasksDone: doneByMember.find((r) => r.assigneeId === m.id)?._count ?? 0,
          tasksOverdue: overdueByMember.find((r) => r.assigneeId === m.id)?._count ?? 0,
          avgResponseMin: responseBy.get(m.id) ?? null,
        };
      });

      const activityRows = await tx.activity.findMany({
        where: { tenantId: ctx.tenantId, ...(memberIds ? { actorId: { in: memberIds } } : {}) },
        orderBy: TIMELINE_ORDER,
        take: 12,
      });

      const revenue = won.reduce((a, d) => a + d.amount, 0);
      return {
        period,
        generatedAt: now.toISOString(),
        scope,
        currency: tenant.currency,
        kpis: {
          newContacts: { value: newContacts, previous: prevContacts },
          activeDeals: { value: openDeals._count, pipelineValue: openDeals._sum.amount ?? 0 },
          revenue: { value: revenue, previous: prevWon._sum.amount ?? 0 },
        },
        revenue: { bucket, points },
        team,
        tasks: {
          open: openTasks,
          overdue: overdueTasks,
          overdueItems: overdueItems.map((t) => {
            const a = t.assigneeId ? assigneeRefs.get(t.assigneeId) : undefined;
            return { id: t.id, title: t.title, dueAt: t.dueAt!.toISOString(), priority: t.priority, assignee: a ? { id: a.id, name: a.name } : null };
          }),
        },
        inbox: {
          awaiting: inbox.awaiting,
          longestWaitMin: inbox.longestWaitMin,
          avgFirstResponseMin: inbox.avgFirstResponseMin,
          items: waiting.map((c) => {
            const a = c.assigneeId ? assigneeRefs.get(c.assigneeId) : undefined;
            return {
              id: c.id,
              channel: c.channel.type,
              displayName: c.contact?.name ?? c.displayName ?? c.handle ?? "",
              preview: (c.messages[0]?.body ?? "").slice(0, 140),
              waitingSince: c.awaitingSince!.toISOString(),
              assignee: a ? { id: a.id, name: a.name } : null,
            };
          }),
        },
        activity: await this.activity.toDtos(tx, ctx.tenantId, activityRows),
      };
    });
  }
}
