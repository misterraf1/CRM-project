import type { DashboardCrmDto, DashboardPeriod } from "@/shared";
import { authedContext } from "../common/context";
import { addDays, startOfDay } from "../common/time";
import { ActivityService, TIMELINE_ORDER } from "../crm/activity.service";
import { stageIds } from "../crm/deals.service";
import { memberRefs, ownerScope } from "../crm/scope";
import type { Database, Tx } from "../db/database";
import type { Filter } from "../db/repo";
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
      // Independent reads go out together; each later step waits only for what it needs
      const [tenant, owners, tasksScope, conversationsScope, openStages, wonStages] = await Promise.all([
        tx.tenant.get({ id: ctx.tenantId }, { projection: { timezone: 1, currency: 1 } }),
        ownerScope(tx, ctx, "dashboard.view_all"),
        taskScope(tx, ctx),
        inboxScope(tx, ctx),
        stageIds(tx, ctx.tenantId, "open"),
        stageIds(tx, ctx.tenantId, "won"),
      ]);
      const tz = tenant.timezone;
      const now = new Date();
      const days = DAYS[period];
      // Period = the last N calendar days including today, in the tenant's time zone
      const start = addDays(startOfDay(now, tz), -(days - 1), tz);
      const prevStart = addDays(start, -days, tz);
      const { scope, memberIds, where: scoped } = owners;
      const base = { tenantId: ctx.tenantId };
      const openTask = { tenantId: ctx.tenantId, parentId: null, status: { $nin: ["DONE", "CANCELED"] } };
      const taskWhere = tasksScope.where;

      // Team: everyone in scope, even with zero sales, so managers see who is idle
      const teamStats = (async () => {
        const members = await tx.membership.find({ tenantId: ctx.tenantId, status: "ACTIVE", ...(memberIds ? { id: { $in: memberIds } } : {}) }, { projection: { id: 1 } });
        const ids = members.map((m) => m.id);
        const [refs, doneByMember, overdueByMember] = await Promise.all([
          memberRefs(tx, ctx.tenantId, ids),
          countBy(tx.task, "assigneeId", { tenantId: ctx.tenantId, parentId: null, status: "DONE", assigneeId: { $in: ids }, completedAt: { $gte: start } }),
          countBy(tx.task, "assigneeId", { ...openTask, assigneeId: { $in: ids }, dueAt: { $lt: now, $ne: null } }),
        ]);
        return { members, refs, doneByMember, overdueByMember };
      })();
      const overdueList = tx.task.find(and(openTask, taskWhere, { dueAt: { $lt: now, $ne: null } }), {
        sort: { dueAt: 1 },
        limit: 5,
        projection: { id: 1, title: 1, dueAt: 1, priority: 1, assigneeId: 1 },
      });
      const awaiting = (async () => {
        const waiting = await tx.conversation.find(and({ tenantId: ctx.tenantId, awaitingSince: { $ne: null }, status: { $ne: "RESOLVED" } }, conversationsScope), {
          sort: { awaitingSince: 1 },
          limit: 5,
        });
        const [channels, contacts, previews] = await Promise.all([
          tx.channel.find({ tenantId: ctx.tenantId, id: { $in: waiting.map((c) => c.channelId) } }, { projection: { id: 1, type: 1 } }),
          tx.contact.find({ tenantId: ctx.tenantId, id: { $in: waiting.map((c) => c.contactId).filter((x): x is string => !!x) } }, { projection: { id: 1, name: 1 } }),
          Promise.all(
            waiting.map((c) => tx.message.findOne({ tenantId: ctx.tenantId, conversationId: c.id, direction: "INBOUND" }, { sort: { createdAt: -1 }, projection: { body: 1 } })),
          ),
        ]);
        return { waiting, channels, contacts, previews };
      })();
      const assignees = Promise.all([overdueList, awaiting]).then(([items, a]) =>
        memberRefs(tx, ctx.tenantId, [...items.map((t) => t.assigneeId), ...a.waiting.map((c) => c.assigneeId)]),
      );
      const activityDtos = tx.activity
        .find({ tenantId: ctx.tenantId, ...(memberIds ? { actorId: { $in: memberIds } } : {}) }, { sort: TIMELINE_ORDER, limit: 12 })
        .then((rows) => this.activity.toDtos(tx, ctx.tenantId, rows));

      const [
        newContacts,
        prevContacts,
        openDeals,
        won,
        prevWon,
        { members, refs, doneByMember, overdueByMember },
        openTasks,
        overdueTasks,
        overdueItems,
        inbox,
        { waiting, channels, contacts, previews },
        assigneeRefs,
        activity,
      ] = await Promise.all([
        tx.contact.count(and(base, scoped, { deletedAt: null, createdAt: { $gte: start } })),
        tx.contact.count(and(base, scoped, { deletedAt: null, createdAt: { $gte: prevStart, $lt: start } })),
        sumOf(tx.deal, "baseAmount", and(base, scoped, { stageId: { $in: openStages } })),
        tx.deal.find(and(base, scoped, { stageId: { $in: wonStages }, closedAt: { $gte: start } }), { projection: { baseAmount: 1, closedAt: 1, ownerId: 1 } }),
        sumOf(tx.deal, "baseAmount", and(base, scoped, { stageId: { $in: wonStages }, closedAt: { $gte: prevStart, $lt: start } })),
        teamStats,
        tx.task.count(and(openTask, taskWhere)),
        tx.task.count(and(openTask, taskWhere, { dueAt: { $lt: now, $ne: null } })),
        overdueList,
        computeInboxMetrics(tx, ctx, start),
        awaiting,
        assignees,
        activityDtos,
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
        points[idx]!.amount += d.baseAmount;
        points[idx]!.deals += 1;
      }

      const channelType = new Map(channels.map((ch) => [ch.id, ch.type]));
      const contactName = new Map(contacts.map((ct) => [ct.id, ct.name]));
      const responseBy = new Map(inbox.byMember.map((m) => [m.member.id, m.avgFirstResponseMin]));
      const team = members.map((m) => {
        const mine = won.filter((d) => d.ownerId === m.id);
        const ref = refs.get(m.id)!;
        return {
          member: ref,
          dealsWon: mine.length,
          revenue: mine.reduce((a, d) => a + d.baseAmount, 0),
          tasksDone: doneByMember.get(m.id)?.count ?? 0,
          tasksOverdue: overdueByMember.get(m.id)?.count ?? 0,
          avgResponseMin: responseBy.get(m.id) ?? null,
        };
      });

      const revenue = won.reduce((a, d) => a + d.baseAmount, 0);
      const [payments, pipeline] = await Promise.all([
        ctx.permissions.includes("finance.view") ? this.payments(tx, ctx.tenantId, now) : null,
        this.pipeline(tx, ctx.tenantId, scoped),
      ]);
      return {
        period,
        generatedAt: now.toISOString(),
        scope,
        currency: tenant.currency,
        payments,
        pipeline,
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
        activity,
      };
    });
  }

  /** What customers still owe on issued invoices, in the company currency (each invoice's own rate). */
  /** Where the open deals stand: the default pipeline's open stages, counts and amounts. */
  private async pipeline(tx: Tx, tenantId: string, scoped: Filter) {
    const p = (await tx.pipeline.findOne({ tenantId, isDefault: true })) ?? (await tx.pipeline.findOne({ tenantId }));
    if (!p) return null;
    const [stages, byStage] = await Promise.all([
      tx.pipelineStage.find({ tenantId, pipelineId: p.id, kind: "open" }, { sort: { order: 1 } }),
      countBy(tx.deal, "stageId", and({ tenantId, pipelineId: p.id, closedAt: null }, scoped), "baseAmount"),
    ]);
    return {
      id: p.id,
      name: p.name,
      stages: stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, count: byStage.get(s.id)?.count ?? 0, amount: byStage.get(s.id)?.sum ?? 0 })),
    };
  }

  private async payments(tx: Tx, tenantId: string, now: Date) {
    const open = await tx.salesDoc.find({ tenantId, kind: "invoice", status: "issued" }, { projection: { total: 1, paidAmount: 1, baseTotal: 1, dueDate: 1 }, limit: 5000 });
    let due = 0;
    let overdue = 0;
    let overdueCount = 0;
    for (const i of open) {
      const left = i.total ? Math.round((i.baseTotal * (i.total - i.paidAmount)) / i.total) : 0;
      due += left;
      if (i.dueDate && i.dueDate < now) {
        overdue += left;
        overdueCount++;
      }
    }
    return { due, overdue, count: open.length, overdueCount };
  }
}
