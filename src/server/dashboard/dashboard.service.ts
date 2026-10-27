import type { DashboardCrmDto, DashboardPeriod } from "@/shared";
import { authedContext } from "../common/context";
import { addDays, startOfDay } from "../common/time";
import { ActivityService, TIMELINE_ORDER } from "../crm/activity.service";
import { stageIds } from "../crm/deals.service";
import { memberRefs, ownerScope } from "../crm/scope";
import type { Database } from "../db/database";
import { and, countBy, sumOf } from "../db/query";
import { computeInboxMetrics, inboxScope } from "../inbox/inbox.service";
import { taskScope } from "../tasks/tasks.service";

const DAYS: Record<DashboardPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };

export class DashboardService {
  constructor(
    private readonly db: Database,
    private readonly activity: ActivityService,
  ) {}

  /** Real CRM figures for the dashboard, narrowed to what the caller may see. */
  async crm(period: DashboardPeriod): Promise<DashboardCrmDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { timezone: 1, currency: 1 } });
      const tz = tenant.timezone;
      const now = new Date();
      const days = DAYS[period];
      // Period = the last N calendar days including today, in the tenant's time zone
      const start = addDays(startOfDay(now, tz), -(days - 1), tz);
      const prevStart = addDays(start, -days, tz);
      const { scope, memberIds, where: scoped } = await ownerScope(tx, ctx, "dashboard.view_all");
      const base = { tenantId: ctx.tenantId };

      const [openStages, wonStages] = await Promise.all([stageIds(tx, ctx.tenantId, "open"), stageIds(tx, ctx.tenantId, "won")]);
      const [newContacts, prevContacts, openDeals, won, prevWon] = await Promise.all([
        tx.contact.count(and(base, scoped, { deletedAt: null, createdAt: { $gte: start } })),
        tx.contact.count(and(base, scoped, { deletedAt: null, createdAt: { $gte: prevStart, $lt: start } })),
        sumOf(tx.deal, "amount", and(base, scoped, { stageId: { $in: openStages } })),
        tx.deal.find(and(base, scoped, { stageId: { $in: wonStages }, closedAt: { $gte: start } }), { projection: { amount: 1, closedAt: 1, ownerId: 1 } }),
        sumOf(tx.deal, "amount", and(base, scoped, { stageId: { $in: wonStages }, closedAt: { $gte: prevStart, $lt: start } })),
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
      const members = await tx.membership.find({ tenantId: ctx.tenantId, status: "ACTIVE", ...(memberIds ? { id: { $in: memberIds } } : {}) }, { projection: { id: 1 } });
      const ids = members.map((m) => m.id);
      const openTask = { tenantId: ctx.tenantId, parentId: null, status: { $nin: ["DONE", "CANCELED"] } };
      const { where: taskWhere } = await taskScope(tx, ctx);
      const [refs, doneByMember, overdueByMember, openTasks, overdueTasks, overdueItems] = await Promise.all([
        memberRefs(tx, ctx.tenantId, ids),
        countBy(tx.task, "assigneeId", { tenantId: ctx.tenantId, parentId: null, status: "DONE", assigneeId: { $in: ids }, completedAt: { $gte: start } }),
        countBy(tx.task, "assigneeId", { ...openTask, assigneeId: { $in: ids }, dueAt: { $lt: now, $ne: null } }),
        tx.task.count(and(openTask, taskWhere)),
        tx.task.count(and(openTask, taskWhere, { dueAt: { $lt: now, $ne: null } })),
        tx.task.find(and(openTask, taskWhere, { dueAt: { $lt: now, $ne: null } }), {
          sort: { dueAt: 1 },
          limit: 5,
          projection: { id: 1, title: 1, dueAt: 1, priority: 1, assigneeId: 1 },
        }),
      ]);
      const [inbox, waiting] = await Promise.all([
        computeInboxMetrics(tx, ctx, start),
        tx.conversation.find(and({ tenantId: ctx.tenantId, awaitingSince: { $ne: null }, status: { $ne: "RESOLVED" } }, await inboxScope(tx, ctx)), {
          sort: { awaitingSince: 1 },
          limit: 5,
        }),
      ]);
      const [channels, contacts, previews] = await Promise.all([
        tx.channel.find({ tenantId: ctx.tenantId, id: { $in: waiting.map((c) => c.channelId) } }, { projection: { id: 1, type: 1 } }),
        tx.contact.find({ tenantId: ctx.tenantId, id: { $in: waiting.map((c) => c.contactId).filter((x): x is string => !!x) } }, { projection: { id: 1, name: 1 } }),
        Promise.all(
          waiting.map((c) => tx.message.findOne({ tenantId: ctx.tenantId, conversationId: c.id, direction: "INBOUND" }, { sort: { createdAt: -1 }, projection: { body: 1 } })),
        ),
      ]);
      const channelType = new Map(channels.map((ch) => [ch.id, ch.type]));
      const contactName = new Map(contacts.map((ct) => [ct.id, ct.name]));
      const assigneeRefs = await memberRefs(tx, ctx.tenantId, [...overdueItems.map((t) => t.assigneeId), ...waiting.map((c) => c.assigneeId)]);
      const responseBy = new Map(inbox.byMember.map((m) => [m.member.id, m.avgFirstResponseMin]));
      const team = members.map((m) => {
        const mine = won.filter((d) => d.ownerId === m.id);
        const ref = refs.get(m.id)!;
        return {
          member: ref,
          dealsWon: mine.length,
          revenue: mine.reduce((a, d) => a + d.amount, 0),
          tasksDone: doneByMember.get(m.id)?.count ?? 0,
          tasksOverdue: overdueByMember.get(m.id)?.count ?? 0,
          avgResponseMin: responseBy.get(m.id) ?? null,
        };
      });

      const activityRows = await tx.activity.find({ tenantId: ctx.tenantId, ...(memberIds ? { actorId: { $in: memberIds } } : {}) }, { sort: TIMELINE_ORDER, limit: 12 });

      const revenue = won.reduce((a, d) => a + d.amount, 0);
      return {
        period,
        generatedAt: now.toISOString(),
        scope,
        currency: tenant.currency,
        kpis: {
          newContacts: { value: newContacts, previous: prevContacts },
          activeDeals: { value: openDeals.count, pipelineValue: openDeals.sum },
          revenue: { value: revenue, previous: prevWon.sum },
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
          items: waiting.map((c, i) => {
            const a = c.assigneeId ? assigneeRefs.get(c.assigneeId) : undefined;
            return {
              id: c.id,
              channel: channelType.get(c.channelId)!,
              displayName: (c.contactId && contactName.get(c.contactId)) || c.displayName || c.handle || "",
              preview: (previews[i]?.body ?? "").slice(0, 140),
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
