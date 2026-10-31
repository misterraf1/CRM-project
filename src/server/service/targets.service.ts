import type { TargetInput, TargetPeriod, TargetProgressDto, TargetsDto } from "@/shared";
import { authedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { localYearMonth, monthStart } from "../common/time";
import { AuditService } from "../audit/audit.service";
import { memberRefs } from "../crm/scope";
import type { Database } from "../db/database";

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

/** Sales targets (monthly / quarterly, company or member) against won deals. */
export class TargetsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async progress(q: { period: TargetPeriod; start?: string }): Promise<TargetsDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { timezone: 1, currency: 1 } });
      const now = localYearMonth(new Date(), tenant.timezone);
      // Default: the current month / quarter
      const [y, m] = q.start ? q.start.split("-").map(Number) as [number, number] : [now.y, q.period === "quarter" ? Math.floor((now.m - 1) / 3) * 3 + 1 : now.m];
      const start = ym(y, m);
      const from = monthStart(y, m, tenant.timezone);
      const to = monthStart(y, m + (q.period === "quarter" ? 3 : 1), tenant.timezone);

      const [targets, wonStages, members] = await Promise.all([
        tx.salesTarget.find({ tenantId: ctx.tenantId, period: q.period, start }),
        tx.pipelineStage.find({ tenantId: ctx.tenantId, kind: "won" }, { projection: { id: 1 } }),
        tx.membership.find({ tenantId: ctx.tenantId, status: "ACTIVE" }, { projection: { id: 1 } }),
      ]);
      const won = await tx.deal.find({ tenantId: ctx.tenantId, stageId: { $in: wonStages.map((s) => s.id) }, closedAt: { $gte: from, $lt: to } }, { projection: { ownerId: 1, baseAmount: 1, amount: 1 } });
      const byMember = new Map<string, { sum: number; n: number }>();
      let total = 0;
      for (const d of won) {
        const value = d.baseAmount ?? d.amount;
        total += value;
        if (!d.ownerId) continue;
        const cur = byMember.get(d.ownerId) ?? { sum: 0, n: 0 };
        byMember.set(d.ownerId, { sum: cur.sum + value, n: cur.n + 1 });
      }
      const seesAll = ctx.permissions.includes("targets.manage") || ctx.permissions.includes("dashboard.view_all");
      const ids = seesAll ? members.map((m) => m.id) : [ctx.membershipId];
      const refs = await memberRefs(tx, ctx.tenantId, ids);
      const row = (memberId: string | null, achieved: number, wonDeals: number): TargetProgressDto => {
        const t = targets.find((x) => x.memberId === memberId);
        const r = memberId ? refs.get(memberId) : undefined;
        return {
          id: t?.id ?? null,
          member: r ? { id: r.id, name: r.name } : null,
          period: q.period,
          start,
          amount: t?.amount ?? 0,
          achieved,
          wonDeals,
          percent: t?.amount ? Math.round((achieved / t.amount) * 100) : 0,
        };
      };
      const memberRows = ids
        .map((id) => row(id, byMember.get(id)?.sum ?? 0, byMember.get(id)?.n ?? 0))
        .filter((r) => r.member)
        .sort((a, b) => b.percent - a.percent || b.achieved - a.achieved);
      return { period: q.period, start, currency: tenant.currency, rows: [row(null, total, won.length), ...memberRows], canManage: ctx.permissions.includes("targets.manage") };
    });
  }

  /** One target per company/member and period: setting it again replaces the amount. */
  async set(input: TargetInput) {
    const ctx = authedContext();
    if (!ctx.permissions.includes("targets.manage")) throw forbidden("Requires permission targets.manage");
    const [, month] = input.start.split("-").map(Number) as [number, number];
    if (input.period === "quarter" && (month - 1) % 3 !== 0) throw new AppError("VALIDATION_FAILED", "A quarter starts in January, April, July or October", { start: ["Not a quarter start"] });
    return this.db.scoped(async (tx) => {
      if (input.memberId && !(await tx.membership.count({ tenantId: ctx.tenantId, id: input.memberId, status: "ACTIVE" }))) {
        throw new AppError("VALIDATION_FAILED", "Unknown member", { memberId: ["Unknown member"] });
      }
      const key = { tenantId: ctx.tenantId, period: input.period, start: input.start, memberId: input.memberId };
      const existing = await tx.salesTarget.findOne(key);
      const row = existing
        ? await tx.salesTarget.update({ id: existing.id }, { $set: { amount: input.amount } })
        : await tx.salesTarget.insertOne({ ...key, amount: input.amount, createdById: ctx.membershipId });
      await this.audit.log(tx, { action: "target.set", entityType: "target", entityId: row.id, diff: input });
      return { id: row.id };
    });
  }

  async remove(id: string) {
    const ctx = authedContext();
    if (!ctx.permissions.includes("targets.manage")) throw forbidden("Requires permission targets.manage");
    await this.db.scoped(async (tx) => {
      const deleted = await tx.salesTarget.deleteMany({ id, tenantId: ctx.tenantId });
      if (!deleted.count) throw notFound("Target");
    });
  }
}
