import type { Plan, Subscription } from "../db/models";
import type {
  AdminInvoiceListResponse,
  AdminOverviewDto,
  AdminPlanDto,
  AdminTenantDetail,
  AdminTenantListResponse,
  AdminTenantRow,
  BillingInterval,
  ExpenseCategory,
  ExpenseDto,
  ExpenseInput,
  PlanUpdateInput,
  SubscriptionStatus,
  SystemHealthDto,
} from "@/shared";
import { AiService } from "../ai/ai.service";
import { AuditService } from "../audit/audit.service";
import { addonsPrice, days, planPrice } from "../billing/pricing";
import { storageUsed } from "../billing/entitlements.service";
import { toInvoiceDto, withPayments } from "../billing/invoices";
import type { PaymentProvider } from "../billing/provider";
import { config } from "../config";
import { AppError, notFound } from "../common/errors";
import { JobsMonitor } from "../common/jobs-monitor";
import type { Database, Tx } from "../db/database";
import { contains, countBy, sumOf } from "../db/query";
import type { Filter } from "../db/repo";

const PAGE = 25;
const STATUSES: SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"];
/** Statuses that pay (past-due still owes this period) */
const PAYING = new Set<SubscriptionStatus>(["ACTIVE", "PAST_DUE"]);

type Sub = Subscription & { plan: Plan };

/** What a subscription brings in per month; yearly plans count as 1/12. */
export function monthlyValue(sub: Sub): number {
  if (!PAYING.has(sub.status)) return 0;
  const interval = sub.interval as BillingInterval;
  const total = planPrice(sub.plan, interval) + addonsPrice(sub.plan, sub.extraSeats, Math.round(sub.extraStorageMb / 1024), interval);
  return interval === "YEAR" ? Math.round(total / 12) : total;
}

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * Platform (Super Admin) reads and actions. Everything here crosses tenants, so it
 * runs through db.system — never call these from tenant routes.
 */
export class AdminService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly jobs: JobsMonitor,
    private readonly ai: AiService,
    private readonly provider: PaymentProvider,
  ) {}

  private get sys(): Tx {
    return this.db.system;
  }

  /** Subscriptions (with plans) of the given companies, by tenant id. */
  private async subscriptions(tenantIds?: string[]): Promise<Map<string, Sub>> {
    const db = this.sys;
    const subs = await db.subscription.find(tenantIds ? { tenantId: { $in: tenantIds } } : {});
    const plans = new Map((await db.plan.find({})).map((p) => [p.id, p]));
    return new Map(subs.filter((sub) => plans.has(sub.planId)).map((sub) => [sub.tenantId, { ...sub, plan: plans.get(sub.planId)! }]));
  }

  async overview(now = new Date()): Promise<AdminOverviewDto> {
    const since30 = new Date(now.getTime() - days(30));
    const since7 = new Date(now.getTime() - days(7));
    const firstMonth = monthStart(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)));
    const db = this.sys;
    const [subMap, signups30d, churned30d, payments, expenses, failedPayments7d, openTickets] = await Promise.all([
      this.subscriptions(),
      db.tenant.count({ createdAt: { $gte: since30 } }),
      db.subscription.count({ status: "CANCELED", updatedAt: { $gte: since30 } }),
      db.payment.find({ status: "succeeded", createdAt: { $gte: firstMonth } }, { projection: { amount: 1, createdAt: 1 } }),
      db.platformExpense.find({ incurredOn: { $gte: firstMonth } }, { projection: { amount: 1, incurredOn: 1 } }),
      db.payment.count({ status: "failed", createdAt: { $gte: since7 } }),
      db.supportTicket.count({ status: { $ne: "closed" } }),
    ]);
    const subs = [...subMap.values()];

    const tenants = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<SubscriptionStatus, number>;
    let mrr = 0;
    for (const sub of subs) {
      tenants[sub.status] += 1;
      mrr += monthlyValue(sub);
    }
    const paying = tenants.ACTIVE + tenants.PAST_DUE;

    const months = Array.from({ length: 6 }, (_, i) => ({
      month: new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i, 1)).toISOString(),
      revenue: 0,
      expenses: 0,
    }));
    const bucket = (d: Date) => months[(d.getUTCFullYear() - firstMonth.getUTCFullYear()) * 12 + d.getUTCMonth() - firstMonth.getUTCMonth()];
    for (const p of payments) bucket(p.createdAt)!.revenue += p.amount;
    for (const e of expenses) {
      const b = bucket(e.incurredOn);
      if (b) b.expenses += e.amount;
    }
    const revenue30d = payments.filter((p) => p.createdAt >= since30).reduce((a, p) => a + p.amount, 0);
    const expenses30d = expenses.filter((e) => e.incurredOn >= since30).reduce((a, e) => a + e.amount, 0);

    return {
      currency: "AZN",
      mrr,
      arr: mrr * 12,
      tenants: { ...tenants, total: subs.length },
      signups30d,
      churned30d,
      churnRate: paying + churned30d ? churned30d / (paying + churned30d) : 0,
      revenue30d,
      expenses30d,
      profit30d: revenue30d - expenses30d,
      months,
      failedPayments7d,
      openTickets,
    };
  }

  async tenants(q: { q?: string; status?: SubscriptionStatus; page: number }): Promise<AdminTenantListResponse> {
    const db = this.sys;
    const withStatus = q.status ? await db.subscription.distinct<string>("tenantId", { status: q.status }) : null;
    const where: Filter = {
      ...(q.q ? { $or: [{ name: contains(q.q) }, { slug: contains(q.q) }] } : {}),
      ...(withStatus ? { id: { $in: withStatus } } : {}),
    };
    const [rows, total] = await Promise.all([db.tenant.find(where, { sort: { createdAt: -1 }, skip: (q.page - 1) * PAGE, limit: PAGE }), db.tenant.count(where)]);
    const ids = rows.map((t) => t.id);
    const [subs, seats, owners] = await Promise.all([
      this.subscriptions(ids),
      countBy(db.membership, "tenantId", { tenantId: { $in: ids }, status: { $in: ["ACTIVE", "INVITED"] } }),
      db.membership.find({ tenantId: { $in: ids }, role: "OWNER", status: "ACTIVE" }, { sort: { joinedAt: 1 }, projection: { tenantId: 1, userId: 1 } }),
    ]);
    const emails = new Map((await db.user.find({ id: { $in: owners.map((o) => o.userId) } }, { projection: { id: 1, email: 1 } })).map((u) => [u.id, u.email]));
    const ownerOf = new Map<string, string>();
    for (const o of owners) if (!ownerOf.has(o.tenantId) && emails.has(o.userId)) ownerOf.set(o.tenantId, emails.get(o.userId)!);
    return {
      total,
      items: rows.filter((t) => subs.has(t.id)).map((t) => this.row(t, subs.get(t.id)!, seats.get(t.id)?.count ?? 0, ownerOf.get(t.id) ?? null)),
    };
  }

  private row(t: { id: string; name: string; slug: string; createdAt: Date }, sub: Sub, seatsUsed: number, ownerEmail: string | null): AdminTenantRow {
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      createdAt: t.createdAt.toISOString(),
      plan: sub.plan.code,
      status: sub.status,
      interval: sub.interval as BillingInterval,
      seats: { used: seatsUsed, limit: sub.plan.seatLimit + sub.extraSeats },
      mrr: monthlyValue(sub),
      ownerEmail,
    };
  }

  async tenant(id: string): Promise<AdminTenantDetail> {
    const db = this.sys;
    const t = await db.tenant.findOne({ id });
    const sub = t && (await this.subscriptions([id])).get(id);
    if (!t || !sub) throw notFound("Company");
    const [memberRows, contacts, deals, tasks, conversations, filesBytes, invoices, activity, scheduled] = await Promise.all([
      db.membership.find({ tenantId: id }, { sort: { role: 1, createdAt: 1 } }),
      db.contact.count({ tenantId: id }),
      db.deal.count({ tenantId: id }),
      db.task.count({ tenantId: id }),
      db.conversation.count({ tenantId: id }),
      storageUsed(db, id),
      db.invoice.find({ tenantId: id }, { sort: { createdAt: -1 }, limit: 20 }).then((rows) => withPayments(db, rows)),
      db.auditLog.find({ tenantId: id }, { sort: { createdAt: -1 }, limit: 20 }),
      sub.scheduledPlanId ? db.plan.findOne({ id: sub.scheduledPlanId }) : null,
    ]);
    const users = new Map((await db.user.find({ id: { $in: memberRows.map((m) => m.userId) } })).map((u) => [u.id, u]));
    const members = memberRows.filter((m) => users.has(m.userId)).map((m) => ({ ...m, user: users.get(m.userId)! }));
    const actorIds = [...new Set(activity.map((a) => a.actorId).filter((x): x is string => !!x))];
    const actors = await db.user.find({ id: { $in: actorIds } }, { projection: { id: 1, fullName: 1 } });
    const actorName = new Map(actors.map((a) => [a.id, a.fullName]));
    const seatsUsed = members.filter((m) => m.status === "ACTIVE" || m.status === "INVITED").length;
    const owner = members.find((m) => m.role === "OWNER" && m.status === "ACTIVE");

    return {
      ...this.row(t, sub, seatsUsed, owner?.user.email ?? null),
      timezone: t.timezone,
      currency: t.currency,
      subscription: {
        trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
        currentPeriodStart: sub.currentPeriodStart.toISOString(),
        currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
        graceEndsAt: sub.graceEndsAt?.toISOString() ?? null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        scheduledPlan: scheduled?.code ?? null,
        extraSeats: sub.extraSeats,
        extraStorageGb: Math.round(sub.extraStorageMb / 1024),
        paymentMethod: (sub.paymentMethod as { brand: string; last4: string } | null) ?? null,
      },
      usage: {
        contacts,
        deals,
        tasks,
        conversations,
        storageMb: { used: Math.ceil(filesBytes / 1048576), limit: sub.plan.storageMb + sub.extraStorageMb },
      },
      members: members.map((m) => ({
        id: m.id,
        fullName: m.user.fullName,
        email: m.user.email,
        role: m.role,
        status: m.status,
        lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
      })),
      invoices: invoices.map(toInvoiceDto),
      activity: activity.map((a) => ({ id: a.id, action: a.action, actor: a.actorId ? (actorName.get(a.actorId) ?? null) : null, createdAt: a.createdAt.toISOString() })),
    };
  }

  /** Support gesture: more trial days (also revives a company suspended at trial end). */
  async extendTrial(tenantId: string, extraDays: number) {
    await this.db.systemTx(async (tx) => {
      const sub = await tx.subscription.findOne({ tenantId });
      if (!sub) throw notFound("Company");
      const revivable = sub.status === "TRIALING" || (sub.status === "SUSPENDED" && !(await tx.invoice.count({ tenantId, status: "PAID" })));
      if (!revivable) throw new AppError("CONFLICT", "Only trials (or companies suspended at trial end that never paid) can get more trial days");
      const base = sub.status === "TRIALING" && sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
      const trialEndsAt = new Date(base.getTime() + days(extraDays));
      await tx.subscription.update({ id: sub.id }, { $set: { status: "TRIALING", trialEndsAt, currentPeriodEnd: trialEndsAt, trialReminderSentAt: null } });
      await tx.tenant.update({ id: tenantId }, { $set: { status: "TRIALING" } });
      await this.audit.log(tx, { action: "platform.trial_extended", entityType: "tenant", entityId: tenantId, tenantId, diff: { days: extraDays, trialEndsAt: trialEndsAt.toISOString() } });
    });
  }

  /** Manual suspension (abuse, chargeback…): the company becomes read-only. */
  async suspend(tenantId: string, reason: string) {
    await this.db.systemTx(async (tx) => {
      const sub = await tx.subscription.findOne({ tenantId });
      if (!sub) throw notFound("Company");
      if (sub.status === "SUSPENDED" || sub.status === "CANCELED") throw new AppError("CONFLICT", "Already inactive");
      await tx.subscription.update({ id: sub.id }, { $set: { status: "SUSPENDED", nextRetryAt: null } });
      await tx.tenant.update({ id: tenantId }, { $set: { status: "SUSPENDED" } });
      await this.audit.log(tx, { action: "platform.suspended", entityType: "tenant", entityId: tenantId, tenantId, diff: { from: sub.status, reason } });
    });
  }

  /** Lifts a manual suspension while the paid period is still running; otherwise the company has to pay. */
  async unsuspend(tenantId: string) {
    await this.db.systemTx(async (tx) => {
      const sub = await tx.subscription.findOne({ tenantId });
      if (!sub) throw notFound("Company");
      const paid = await tx.invoice.count({ tenantId, status: "PAID" });
      if (sub.status !== "SUSPENDED" || !paid || sub.currentPeriodEnd <= new Date()) {
        throw new AppError("CONFLICT", "Only a suspended company with a paid, still-running period can be reactivated here");
      }
      await tx.subscription.update({ id: sub.id }, { $set: { status: "ACTIVE", graceEndsAt: null, retryCount: 0 } });
      await tx.tenant.update({ id: tenantId }, { $set: { status: "ACTIVE" } });
      await this.audit.log(tx, { action: "platform.unsuspended", entityType: "tenant", entityId: tenantId, tenantId });
    });
  }

  async plans(): Promise<AdminPlanDto[]> {
    const [plans, counts] = await Promise.all([this.sys.plan.find({}, { sort: { sortOrder: 1 } }), countBy(this.sys.subscription, "planId", { status: { $ne: "CANCELED" } })]);
    return plans.map((p) => this.planDto(p, counts.get(p.id)?.count ?? 0));
  }

  private planDto(p: Plan, tenants: number): AdminPlanDto {
    return {
      code: p.code,
      name: p.name,
      priceMonthly: p.priceMonthly,
      priceYearly: p.priceYearly,
      currency: p.currency,
      seatLimit: p.seatLimit,
      storageMb: p.storageMb,
      extraSeatPrice: p.extraSeatPrice,
      extraStorageGbPrice: p.extraStorageGbPrice,
      aiCredits: p.aiCredits,
      features: p.features,
      isPublic: p.isPublic,
      tenants,
    };
  }

  /** New prices apply to the next invoice; periods already paid keep their price. */
  async updatePlan(code: string, input: PlanUpdateInput): Promise<AdminPlanDto> {
    const plan = await this.db.systemTx(async (tx) => {
      const before = await tx.plan.findOne({ code });
      if (!before) throw notFound("Plan");
      const after = await tx.plan.update({ id: before.id }, { $set: input });
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of Object.keys(input) as (keyof PlanUpdateInput)[]) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) diff[key] = { from: before[key], to: after[key] };
      }
      await this.audit.log(tx, { action: "platform.plan_updated", entityType: "plan", entityId: before.id, tenantId: undefined, diff: diff as never });
      return after;
    });
    const tenants = await this.sys.subscription.count({ planId: plan.id, status: { $ne: "CANCELED" } });
    return this.planDto(plan, tenants);
  }

  async invoices(q: { status?: "OPEN" | "PAID" | "FAILED" | "VOID"; page: number }): Promise<AdminInvoiceListResponse> {
    const where: Filter = q.status ? { status: q.status } : {};
    const db = this.sys;
    const [invoices, total, paid, failed] = await Promise.all([
      db.invoice.find(where, { sort: { createdAt: -1 }, skip: (q.page - 1) * PAGE, limit: PAGE }),
      db.invoice.count(where),
      sumOf(db.invoice, "amount", { ...where, status: "PAID" }),
      sumOf(db.invoice, "amount", { ...where, status: "FAILED" }),
    ]);
    const companies = new Map((await db.tenant.find({ id: { $in: invoices.map((i) => i.tenantId) } }, { projection: { id: 1, name: 1 } })).map((t) => [t.id, t.name]));
    const rows = (await withPayments(db, invoices)).map((i) => ({ ...i, tenant: { name: companies.get(i.tenantId) ?? "" }, payments: i.payments.reverse() }));
    return {
      total,
      totals: { paid: paid.sum, failed: failed.sum },
      items: rows.map((i) => ({
        id: i.id,
        number: i.number,
        tenantId: i.tenantId,
        company: i.tenant.name,
        kind: i.kind as AdminInvoiceListResponse["items"][number]["kind"],
        status: i.status,
        amount: i.amount,
        currency: i.currency,
        createdAt: i.createdAt.toISOString(),
        paidAt: i.paidAt?.toISOString() ?? null,
        failureCode: i.payments[0]?.status === "failed" ? (i.payments[0].failureCode ?? null) : null,
      })),
    };
  }

  async expenses(): Promise<ExpenseDto[]> {
    const rows = await this.sys.platformExpense.find({}, { sort: { incurredOn: -1, createdAt: -1 }, limit: 200 });
    return rows.map((e) => this.expenseDto(e));
  }

  private expenseDto(e: { id: string; category: string; vendor: string; amount: number; currency: string; incurredOn: Date; note: string | null }): ExpenseDto {
    return { id: e.id, category: e.category as ExpenseCategory, vendor: e.vendor, amount: e.amount, currency: e.currency, incurredOn: e.incurredOn.toISOString().slice(0, 10), note: e.note };
  }

  async addExpense(input: ExpenseInput): Promise<ExpenseDto> {
    const e = await this.db.systemTx(async (tx) => {
      const row = await tx.platformExpense.insertOne({ ...input, note: input.note || null, incurredOn: new Date(`${input.incurredOn}T00:00:00Z`) });
      await this.audit.log(tx, { action: "platform.expense_added", entityType: "expense", entityId: row.id, tenantId: undefined, diff: { vendor: row.vendor, amount: row.amount } });
      return row;
    });
    return this.expenseDto(e);
  }

  async deleteExpense(id: string) {
    await this.db.systemTx(async (tx) => {
      const row = await tx.platformExpense.findOne({ id });
      if (!row) throw notFound("Expense");
      await tx.platformExpense.delete({ id });
      await this.audit.log(tx, { action: "platform.expense_deleted", entityType: "expense", entityId: id, tenantId: undefined, diff: { vendor: row.vendor, amount: row.amount } });
    });
  }

  async system(now = new Date()): Promise<SystemHealthDto> {
    let latencyMs: number | null = null;
    const started = performance.now();
    const dbOk = await this.db.ping().then(
      () => true,
      () => false,
    );
    if (dbOk) latencyMs = Math.round(performance.now() - started);
    const since = new Date(now.getTime() - days(1));
    const db = this.sys;
    const mailWhere = (status: string) => ({ status, createdAt: { $gte: since } });
    const [mailQueued, mailSent, mailFailed, mailNotSent, mailRecent] = dbOk
      ? await Promise.all([
          db.emailMessage.count({ status: { $in: ["queued", "sending"] } }),
          db.emailMessage.count(mailWhere("sent")),
          db.emailMessage.count(mailWhere("failed")),
          db.emailMessage.count(mailWhere("not_sent")),
          db.emailMessage
            .find({}, { sort: { createdAt: -1 }, limit: 20, projection: { id: 1, to: 1, subject: 1, template: 1, status: 1, error: 1, createdAt: 1 } })
            .then((rows) => rows.map(({ id, to, subject, template, status, error, createdAt }) => ({ id, to, subject, template, status, error, createdAt }))),
        ])
      : [0, 0, 0, 0, []];
    const [received24h, failed24h, recentErrors, connected, erroredRows] = dbOk
      ? await Promise.all([
          db.webhookEvent.count({ receivedAt: { $gte: since } }),
          db.webhookEvent.count({ receivedAt: { $gte: since }, error: { $ne: null } }),
          db.webhookEvent.find({ error: { $ne: null } }, { sort: { receivedAt: -1 }, limit: 10, projection: { id: 1, provider: 1, error: 1, receivedAt: 1 } }),
          db.channel.count({ status: "connected" }),
          db.channel.find({ status: "error" }, { limit: 20 }),
        ])
      : [0, 0, [], 0, []];
    const errorTenants = new Map((await db.tenant.find({ id: { $in: erroredRows.map((c) => c.tenantId) } }, { projection: { id: 1, name: 1 } })).map((t) => [t.id, t.name]));
    const errored = erroredRows.map((c) => ({ ...c, tenant: { name: errorTenants.get(c.tenantId) ?? "" } }));
    return {
      db: { ok: dbOk, latencyMs },
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      node: process.version,
      jobsEnabled: config().JOBS_ENABLED,
      jobs: this.jobs.list(),
      webhooks: {
        received24h,
        failed24h,
        recentErrors: recentErrors.map((w) => ({ id: w.id, provider: w.provider, error: w.error ?? "", receivedAt: w.receivedAt.toISOString() })),
      },
      channels: {
        connected,
        error: errored.length,
        errors: errored.map((c) => ({ id: c.id, tenant: c.tenant.name, name: c.name, type: c.type })),
      },
      billingProvider: this.provider.name,
      ai: { provider: config().AI_PROVIDER, configured: this.ai.available, models: this.ai.client?.status?.() ?? [] },
      mail: {
        configured: !!config().SMTP_URL,
        queued: mailQueued,
        sent24h: mailSent,
        failed24h: mailFailed,
        notSent24h: mailNotSent,
        recent: mailRecent.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      },
    };
  }
}
