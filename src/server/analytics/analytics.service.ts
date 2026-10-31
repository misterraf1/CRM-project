import type { AnalyticsAdvancedDto, AnalyticsBasicDto, AnalyticsPeriod, AnalyticsQuery, ChannelType, MemberPerformance, MonthTrend } from "@/shared";
import { authedContext, type AuthedContext } from "../common/context";
import { addDays, startOfDay, startOfMonth } from "../common/time";
import { memberRefs, ownerScope } from "../crm/scope";
import { inboxScope } from "../inbox/inbox.service";
import type { Database, Tx } from "../db/database";
import type { Deal } from "../db/models";
import { and, countBy } from "../db/query";
import type { Filter } from "../db/repo";
import { taskScope } from "../tasks/tasks.service";

const DAYS: Record<AnalyticsPeriod, number> = { "30d": 30, "90d": 90, "365d": 365 };
const DAY_MS = 86_400_000;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const minutes = (msList: number[]) => {
  const a = avg(msList);
  return a === null ? null : Math.round(a / 60_000);
};
const rate = (part: number, whole: number) => (whole ? part / whole : null);

/** Deals with their stage's name and kind (open / won / lost). */
async function withStages(tx: Tx, tenantId: string, deals: Deal[]) {
  const stages = new Map((await tx.pipelineStage.find({ tenantId }, { projection: { id: 1, name: 1, kind: 1 } })).map((st) => [st.id, { name: st.name, kind: st.kind }]));
  return deals.map((d) => ({ ...d, stage: stages.get(d.stageId) ?? { name: "", kind: "open" } }));
}

const DEAL_FIELDS = { baseAmount: 1, createdAt: 1, closedAt: 1, ownerId: 1, contactId: 1, lostReason: 1, stageId: 1 } as const;

/**
 * Analytics over the same visibility rules as the rest of the CRM: owners and admins
 * see the company, managers their department, others their own records.
 */
export class AnalyticsService {
  constructor(private readonly db: Database) {}

  /** The period: the last 30/90/365 days, or any from–to range (company days, both inclusive). */
  private async frame(tx: Tx, ctx: AuthedContext, q: AnalyticsQuery) {
    const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { timezone: 1, currency: 1 } });
    const now = new Date();
    const custom = q.from && q.to;
    const start = custom ? startOfDay(new Date(`${q.from}T12:00:00Z`), tenant.timezone) : addDays(startOfDay(now, tenant.timezone), -(DAYS[q.period] - 1), tenant.timezone);
    const end = custom ? addDays(startOfDay(new Date(`${q.to}T12:00:00Z`), tenant.timezone), 1, tenant.timezone) : now;
    const owners = await ownerScope(tx, ctx, "dashboard.view_all");
    return { tenant, now, start, end, owners };
  }

  async basic(q: AnalyticsQuery): Promise<AnalyticsBasicDto> {
    const period = q.period;
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const { tenant, now, start, end, owners } = await this.frame(tx, ctx, q);
      const base = { tenantId: ctx.tenantId };
      const dealWhere = (extra: Filter) => and(base, owners.where, extra);
      const deals = async (where: Filter) => withStages(tx, ctx.tenantId, await tx.deal.find(where, { projection: DEAL_FIELDS }));

      const defaultPipeline = await tx.pipeline.findOne({ tenantId: ctx.tenantId, isDefault: true });
      const pipeline = defaultPipeline && {
        ...defaultPipeline,
        stages: await tx.pipelineStage.find({ tenantId: ctx.tenantId, pipelineId: defaultPipeline.id }, { sort: { order: 1 } }),
      };
      const { where: taskWhere } = await taskScope(tx, ctx);
      const convScope = await inboxScope(tx, ctx);

      const [createdDeals, closedDeals, byStage, contacts, conversations, tasksCreated, tasksDone, overdueOpen] = await Promise.all([
        deals(dealWhere({ createdAt: { $gte: start, $lt: end } })),
        deals(dealWhere({ closedAt: { $gte: start, $lt: end } })),
        pipeline
          ? // Open stages: everything sitting there now; won/lost: closed in the period
            countBy(tx.deal, "stageId", dealWhere({ pipelineId: pipeline.id, $or: [{ closedAt: null }, { closedAt: { $gte: start, $lt: end } }] }), "baseAmount")
          : new Map<string, { count: number; sum: number }>(),
        tx.contact.find(and(base, owners.where, { deletedAt: null, createdAt: { $gte: start, $lt: end } }), { projection: { id: 1, source: 1, stage: 1 } }),
        tx.conversation.find(and(base, convScope, { createdAt: { $gte: start, $lt: end } }), { projection: { firstResponseMs: 1, channelId: 1 } }),
        tx.task.count(and(base, taskWhere, { parentId: null, createdAt: { $gte: start, $lt: end } })),
        tx.task.find(and(base, taskWhere, { parentId: null, status: "DONE", completedAt: { $gte: start, $lt: end } }), { projection: { completedAt: 1, dueAt: 1 } }),
        tx.task.count(and(base, taskWhere, { parentId: null, status: { $nin: ["DONE", "CANCELED"] }, dueAt: { $lt: now, $ne: null } })),
      ]);
      const channelType = new Map((await tx.channel.find({ tenantId: ctx.tenantId }, { projection: { id: 1, type: 1 } })).map((ch) => [ch.id, ch.type]));

      const won = closedDeals.filter((d) => d.stage.kind === "won");
      const lost = closedDeals.filter((d) => d.stage.kind === "lost");
      const wonAmount = won.reduce((a, d) => a + d.baseAmount, 0);

      const funnel = (pipeline?.stages ?? []).map((s) => ({
        stageId: s.id,
        name: s.name,
        kind: s.kind as "open" | "won" | "lost",
        deals: byStage.get(s.id)?.count ?? 0,
        amount: byStage.get(s.id)?.sum ?? 0,
      }));

      const reasons = new Map<string, { deals: number; amount: number }>();
      for (const d of lost) {
        const key = d.lostReason?.trim() || "";
        const r = reasons.get(key) ?? { deals: 0, amount: 0 };
        r.deals += 1;
        r.amount += d.baseAmount;
        reasons.set(key, r);
      }

      // Lead sources: contacts created in the period, and the deals they brought in
      const sourceOf = new Map(contacts.map((c) => [c.id, c.source?.trim() || ""]));
      const sources = new Map<string, { contacts: number; customers: number; wonDeals: number; wonAmount: number }>();
      const sourceRow = (key: string) => {
        if (!sources.has(key)) sources.set(key, { contacts: 0, customers: 0, wonDeals: 0, wonAmount: 0 });
        return sources.get(key)!;
      };
      for (const c of contacts) {
        const row = sourceRow(c.source?.trim() || "");
        row.contacts += 1;
        if (c.stage === "CUSTOMER") row.customers += 1;
      }
      for (const d of won) {
        if (!d.contactId || !sourceOf.has(d.contactId)) continue;
        const row = sourceRow(sourceOf.get(d.contactId)!);
        row.wonDeals += 1;
        row.wonAmount += d.baseAmount;
      }

      const channels = new Map<string, number[]>();
      const channelCount = new Map<string, number>();
      for (const c of conversations) {
        const type = channelType.get(c.channelId) ?? "WEBCHAT";
        channelCount.set(type, (channelCount.get(type) ?? 0) + 1);
        if (c.firstResponseMs !== null) channels.set(type, [...(channels.get(type) ?? []), c.firstResponseMs]);
      }

      return {
        period,
        scope: owners.scope,
        currency: tenant.currency,
        generatedAt: now.toISOString(),
        sales: {
          created: createdDeals.length,
          won: createdDeals.filter((d) => d.stage.kind === "won").length,
          lost: createdDeals.filter((d) => d.stage.kind === "lost").length,
          stillOpen: createdDeals.filter((d) => d.stage.kind === "open").length,
          winRate: rate(won.length, won.length + lost.length),
          wonAmount,
          avgDealSize: won.length ? Math.round(wonAmount / won.length) : null,
          avgCycleDays: round1(avg(won.map((d) => Math.max(0, d.closedAt!.getTime() - d.createdAt.getTime()) / DAY_MS))),
        },
        funnel,
        lostReasons: [...reasons].map(([reason, r]) => ({ reason, ...r })).sort((a, b) => b.deals - a.deals),
        sources: [...sources].map(([source, r]) => ({ source, ...r })).sort((a, b) => b.contacts - a.contacts),
        inbox: [...channelCount].map(([channel, count]) => ({
          channel: channel as ChannelType,
          conversations: count,
          avgFirstResponseMin: minutes(channels.get(channel) ?? []),
        })),
        tasks: {
          created: tasksCreated,
          completed: tasksDone.length,
          completedOnTime: tasksDone.filter((t) => t.dueAt && t.completedAt! <= t.dueAt).length,
          overdueOpen,
        },
      };
    });
  }

  async advanced(q: AnalyticsQuery): Promise<AnalyticsAdvancedDto> {
    const period = q.period;
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const { tenant, start, end, owners, now } = await this.frame(tx, ctx, q);
      const base = { tenantId: ctx.tenantId };
      const members = await tx.membership.find(
        { tenantId: ctx.tenantId, status: "ACTIVE", ...(owners.memberIds ? { id: { $in: owners.memberIds } } : {}) },
        { projection: { id: 1 }, sort: { createdAt: 1 } },
      );
      const ids = members.map((m) => m.id);

      // 12 local calendar months, oldest first
      const monthStarts = [startOfMonth(now, tenant.timezone)];
      while (monthStarts.length < 12) monthStarts.unshift(startOfMonth(addDays(monthStarts[0]!, -1, tenant.timezone), tenant.timezone));
      const trendStart = monthStarts[0]!;

      const wonStages = (await tx.pipelineStage.find({ tenantId: ctx.tenantId, kind: "won" }, { projection: { id: 1 } })).map((st) => st.id);
      const [refs, created, closed, tasksDone, conversations, trendContacts, trendWon] = await Promise.all([
        memberRefs(tx, ctx.tenantId, ids),
        countBy(tx.deal, "ownerId", { ...base, ownerId: { $in: ids }, createdAt: { $gte: start, $lt: end } }),
        tx.deal
          .find({ ...base, ownerId: { $in: ids }, closedAt: { $gte: start, $lt: end } }, { projection: DEAL_FIELDS })
          .then((rows) => withStages(tx, ctx.tenantId, rows)),
        tx.task.find(
          { ...base, parentId: null, assigneeId: { $in: ids }, status: "DONE", completedAt: { $gte: start, $lt: end } },
          { projection: { assigneeId: 1, completedAt: 1, dueAt: 1 } },
        ),
        tx.conversation.find({ ...base, assigneeId: { $in: ids }, createdAt: { $gte: start, $lt: end } }, { projection: { assigneeId: 1, firstResponseMs: 1 } }),
        tx.contact.find(and(base, owners.where, { deletedAt: null, createdAt: { $gte: trendStart } }), { projection: { createdAt: 1 } }),
        tx.deal.find(and(base, owners.where, { stageId: { $in: wonStages }, closedAt: { $gte: trendStart, $ne: null } }), { projection: { baseAmount: 1, closedAt: 1 } }),
      ]);

      const perMember: MemberPerformance[] = ids.map((id) => {
        const mine = closed.filter((d) => d.ownerId === id);
        const w = mine.filter((d) => d.stage.kind === "won");
        const l = mine.filter((d) => d.stage.kind === "lost");
        const done = tasksDone.filter((t) => t.assigneeId === id);
        const dated = done.filter((t) => t.dueAt);
        const convs = conversations.filter((c) => c.assigneeId === id);
        return {
          member: refs.get(id) ?? { id, name: "—", title: null },
          dealsCreated: created.get(id)?.count ?? 0,
          dealsWon: w.length,
          dealsLost: l.length,
          winRate: rate(w.length, w.length + l.length),
          revenue: w.reduce((a, d) => a + d.baseAmount, 0),
          avgCycleDays: round1(avg(w.map((d) => Math.max(0, d.closedAt!.getTime() - d.createdAt.getTime()) / DAY_MS))),
          tasksDone: done.length,
          onTimeRate: rate(dated.filter((t) => t.completedAt! <= t.dueAt!).length, dated.length),
          conversations: convs.length,
          avgFirstResponseMin: minutes(convs.flatMap((c) => (c.firstResponseMs === null ? [] : [c.firstResponseMs]))),
        };
      });
      perMember.sort((a, b) => b.revenue - a.revenue || b.dealsWon - a.dealsWon);

      const monthIndex = (d: Date) => {
        let i = monthStarts.length - 1;
        while (i > 0 && d < monthStarts[i]!) i--;
        return i;
      };
      const months: MonthTrend[] = monthStarts.map((m) => ({ month: m.toISOString(), newContacts: 0, dealsWon: 0, revenue: 0 }));
      for (const c of trendContacts) months[monthIndex(c.createdAt)]!.newContacts += 1;
      for (const d of trendWon) {
        const row = months[monthIndex(d.closedAt!)]!;
        row.dealsWon += 1;
        row.revenue += d.baseAmount;
      }

      return { period, scope: owners.scope, currency: tenant.currency, members: perMember, months };
    });
  }

  /** Deals created in the period as CSV (UTF-8 with BOM so Excel shows Azerbaijani letters). */
  async exportDeals(q: AnalyticsQuery): Promise<string> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const { start, end, owners } = await this.frame(tx, ctx, q);
      const rows0 = await withStages(tx, ctx.tenantId, await tx.deal.find(and({ tenantId: ctx.tenantId }, owners.where, { createdAt: { $gte: start, $lt: end } }), { sort: { createdAt: 1 } }));
      const contactIds = [...new Set(rows0.map((d) => d.contactId).filter((x): x is string => !!x))];
      const contacts = new Map((await tx.contact.find({ tenantId: ctx.tenantId, id: { $in: contactIds } }, { projection: { id: 1, name: 1, source: 1 } })).map((c) => [c.id, c]));
      const deals = rows0.map((d) => ({ ...d, contact: (d.contactId && contacts.get(d.contactId)) || null }));
      const refs = await memberRefs(tx, ctx.tenantId, deals.map((d) => d.ownerId));
      const cell = (v: string | number | null | undefined) => {
        const s = v === null || v === undefined ? "" : String(v);
        // Quote everything; neutralise spreadsheet formulas
        return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
      };
      const header = ["id", "title", "amount", "currency", "base_amount", "stage", "result", "owner", "contact", "source", "created_at", "closed_at", "lost_reason"];
      const rows = deals.map((d) =>
        [
          d.id,
          d.title,
          (d.amount / 100).toFixed(2),
          d.currency,
          ((d.baseAmount ?? d.amount) / 100).toFixed(2),
          d.stage.name,
          d.stage.kind,
          d.ownerId ? (refs.get(d.ownerId)?.name ?? "") : "",
          d.contact?.name ?? "",
          d.contact?.source ?? "",
          d.createdAt.toISOString(),
          d.closedAt?.toISOString() ?? "",
          d.lostReason ?? "",
        ]
          .map(cell)
          .join(","),
      );
      return `﻿${[header.map(cell).join(","), ...rows].join("\r\n")}\r\n`;
    });
  }
}
