import { Inject, Injectable } from "@nestjs/common";
import type { Plan, Prisma, Subscription } from "@prisma/client";
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
} from "@axis/shared";
import { AuditService } from "../audit/audit.service";
import { addonsPrice, days, planPrice } from "../billing/pricing";
import { toInvoiceDto } from "../billing/invoices";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../billing/provider";
import { config } from "../config";
import { AppError, notFound } from "../common/errors";
import { JobsMonitor } from "../common/jobs-monitor";
import { PrismaService } from "../prisma/prisma.service";

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
 * runs through prisma.system() — never call these from tenant controllers.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobsMonitor,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  private sys<T>(fn: () => Promise<T>) {
    return this.prisma.system(fn);
  }

  async overview(now = new Date()): Promise<AdminOverviewDto> {
    const since30 = new Date(now.getTime() - days(30));
    const since7 = new Date(now.getTime() - days(7));
    const firstMonth = monthStart(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)));
    const db = this.prisma;
    const [subs, signups30d, churned30d, payments, expenses, failedPayments7d, openTickets] = await this.sys(() =>
      Promise.all([
        db.subscription.findMany({ include: { plan: true } }),
        db.tenant.count({ where: { createdAt: { gte: since30 } } }),
        db.subscription.count({ where: { status: "CANCELED", updatedAt: { gte: since30 } } }),
        db.payment.findMany({ where: { status: "succeeded", createdAt: { gte: firstMonth } }, select: { amount: true, createdAt: true } }),
        db.platformExpense.findMany({ where: { incurredOn: { gte: firstMonth } }, select: { amount: true, incurredOn: true } }),
        db.payment.count({ where: { status: "failed", createdAt: { gte: since7 } } }),
        db.supportTicket.count({ where: { status: { not: "closed" } } }),
      ]),
    );

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
    const where: Prisma.TenantWhereInput = {
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { slug: { contains: q.q, mode: "insensitive" } }] } : {}),
      ...(q.status ? { subscription: { is: { status: q.status } } } : {}),
    };
    const [rows, total] = await this.sys(() =>
      Promise.all([
        this.prisma.tenant.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * PAGE, take: PAGE, include: { subscription: { include: { plan: true } } } }),
        this.prisma.tenant.count({ where }),
      ]),
    );
    const ids = rows.map((t) => t.id);
    const [seatCounts, owners] = await this.sys(() =>
      Promise.all([
        this.prisma.membership.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, status: { in: ["ACTIVE", "INVITED"] } }, _count: { _all: true } }),
        this.prisma.membership.findMany({ where: { tenantId: { in: ids }, role: "OWNER", status: "ACTIVE" }, include: { user: { select: { email: true } } }, orderBy: { joinedAt: "asc" } }),
      ]),
    );
    const seats = new Map(seatCounts.map((c) => [c.tenantId, c._count._all]));
    const ownerOf = new Map<string, string>();
    for (const o of owners) if (!ownerOf.has(o.tenantId)) ownerOf.set(o.tenantId, o.user.email);
    return {
      total,
      items: rows.filter((t) => t.subscription).map((t) => this.row(t, t.subscription!, seats.get(t.id) ?? 0, ownerOf.get(t.id) ?? null)),
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
    const db = this.prisma;
    const t = await this.sys(() => db.tenant.findUnique({ where: { id }, include: { subscription: { include: { plan: true } } } }));
    if (!t?.subscription) throw notFound("Company");
    const sub = t.subscription;
    const [members, contacts, deals, tasks, conversations, files, invoices, activity, scheduled] = await this.sys(() =>
      Promise.all([
        db.membership.findMany({ where: { tenantId: id }, include: { user: true }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] }),
        db.contact.count({ where: { tenantId: id } }),
        db.deal.count({ where: { tenantId: id } }),
        db.task.count({ where: { tenantId: id } }),
        db.conversation.count({ where: { tenantId: id } }),
        db.fileObject.aggregate({ where: { tenantId: id }, _sum: { sizeBytes: true } }),
        db.invoice.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { payments: true } }),
        db.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
        sub.scheduledPlanId ? db.plan.findUnique({ where: { id: sub.scheduledPlanId } }) : null,
      ]),
    );
    const actorIds = [...new Set(activity.map((a) => a.actorId).filter((x): x is string => !!x))];
    const actors = await this.sys(() => db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } }));
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
        storageMb: { used: Math.ceil((files._sum.sizeBytes ?? 0) / 1048576), limit: sub.plan.storageMb + sub.extraStorageMb },
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
    await this.prisma.systemTx(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { tenantId } });
      if (!sub) throw notFound("Company");
      const revivable = sub.status === "TRIALING" || (sub.status === "SUSPENDED" && !(await tx.invoice.count({ where: { tenantId, status: "PAID" } })));
      if (!revivable) throw new AppError("CONFLICT", "Only trials (or companies suspended at trial end that never paid) can get more trial days");
      const base = sub.status === "TRIALING" && sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
      const trialEndsAt = new Date(base.getTime() + days(extraDays));
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: "TRIALING", trialEndsAt, currentPeriodEnd: trialEndsAt, trialReminderSentAt: null },
      });
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "TRIALING" } });
      await this.audit.log(tx, { action: "platform.trial_extended", entityType: "tenant", entityId: tenantId, tenantId, diff: { days: extraDays, trialEndsAt: trialEndsAt.toISOString() } });
    });
  }

  /** Manual suspension (abuse, chargeback…): the company becomes read-only. */
  async suspend(tenantId: string, reason: string) {
    await this.prisma.systemTx(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { tenantId } });
      if (!sub) throw notFound("Company");
      if (sub.status === "SUSPENDED" || sub.status === "CANCELED") throw new AppError("CONFLICT", "Already inactive");
      await tx.subscription.update({ where: { id: sub.id }, data: { status: "SUSPENDED", nextRetryAt: null } });
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } });
      await this.audit.log(tx, { action: "platform.suspended", entityType: "tenant", entityId: tenantId, tenantId, diff: { from: sub.status, reason } });
    });
  }

  /** Lifts a manual suspension while the paid period is still running; otherwise the company has to pay. */
  async unsuspend(tenantId: string) {
    await this.prisma.systemTx(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { tenantId } });
      if (!sub) throw notFound("Company");
      const paid = await tx.invoice.count({ where: { tenantId, status: "PAID" } });
      if (sub.status !== "SUSPENDED" || !paid || sub.currentPeriodEnd <= new Date()) {
        throw new AppError("CONFLICT", "Only a suspended company with a paid, still-running period can be reactivated here");
      }
      await tx.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", graceEndsAt: null, retryCount: 0 } });
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } });
      await this.audit.log(tx, { action: "platform.unsuspended", entityType: "tenant", entityId: tenantId, tenantId });
    });
  }

  async plans(): Promise<AdminPlanDto[]> {
    const [plans, counts] = await this.sys(() =>
      Promise.all([
        this.prisma.plan.findMany({ orderBy: { sortOrder: "asc" } }),
        this.prisma.subscription.groupBy({ by: ["planId"], where: { status: { not: "CANCELED" } }, _count: { _all: true } }),
      ]),
    );
    const byPlan = new Map(counts.map((c) => [c.planId, c._count._all]));
    return plans.map((p) => this.planDto(p, byPlan.get(p.id) ?? 0));
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
    const plan = await this.prisma.systemTx(async (tx) => {
      const before = await tx.plan.findUnique({ where: { code } });
      if (!before) throw notFound("Plan");
      const after = await tx.plan.update({ where: { id: before.id }, data: input });
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of Object.keys(input) as (keyof PlanUpdateInput)[]) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) diff[key] = { from: before[key], to: after[key] };
      }
      await this.audit.log(tx, { action: "platform.plan_updated", entityType: "plan", entityId: before.id, tenantId: undefined, diff: diff as Prisma.InputJsonValue });
      return after;
    });
    const tenants = await this.sys(() => this.prisma.subscription.count({ where: { planId: plan.id, status: { not: "CANCELED" } } }));
    return this.planDto(plan, tenants);
  }

  async invoices(q: { status?: "OPEN" | "PAID" | "FAILED" | "VOID"; page: number }): Promise<AdminInvoiceListResponse> {
    const where: Prisma.InvoiceWhereInput = q.status ? { status: q.status } : {};
    const db = this.prisma;
    const [rows, total, paid, failed] = await this.sys(() =>
      Promise.all([
        db.invoice.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * PAGE, take: PAGE, include: { tenant: { select: { name: true } }, payments: { orderBy: { createdAt: "desc" }, take: 1 } } }),
        db.invoice.count({ where }),
        db.invoice.aggregate({ where: { ...where, status: "PAID" }, _sum: { amount: true } }),
        db.invoice.aggregate({ where: { ...where, status: "FAILED" }, _sum: { amount: true } }),
      ]),
    );
    return {
      total,
      totals: { paid: paid._sum.amount ?? 0, failed: failed._sum.amount ?? 0 },
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
    const rows = await this.sys(() => this.prisma.platformExpense.findMany({ orderBy: [{ incurredOn: "desc" }, { createdAt: "desc" }], take: 200 }));
    return rows.map((e) => this.expenseDto(e));
  }

  private expenseDto(e: { id: string; category: string; vendor: string; amount: number; currency: string; incurredOn: Date; note: string | null }): ExpenseDto {
    return { id: e.id, category: e.category as ExpenseCategory, vendor: e.vendor, amount: e.amount, currency: e.currency, incurredOn: e.incurredOn.toISOString().slice(0, 10), note: e.note };
  }

  async addExpense(input: ExpenseInput): Promise<ExpenseDto> {
    const e = await this.prisma.systemTx(async (tx) => {
      const row = await tx.platformExpense.create({ data: { ...input, note: input.note || null, incurredOn: new Date(`${input.incurredOn}T00:00:00Z`) } });
      await this.audit.log(tx, { action: "platform.expense_added", entityType: "expense", entityId: row.id, tenantId: undefined, diff: { vendor: row.vendor, amount: row.amount } });
      return row;
    });
    return this.expenseDto(e);
  }

  async deleteExpense(id: string) {
    await this.prisma.systemTx(async (tx) => {
      const row = await tx.platformExpense.findUnique({ where: { id } });
      if (!row) throw notFound("Expense");
      await tx.platformExpense.delete({ where: { id } });
      await this.audit.log(tx, { action: "platform.expense_deleted", entityType: "expense", entityId: id, tenantId: undefined, diff: { vendor: row.vendor, amount: row.amount } });
    });
  }

  async system(now = new Date()): Promise<SystemHealthDto> {
    let latencyMs: number | null = null;
    const started = performance.now();
    const dbOk = await this.prisma.ping().then(
      () => true,
      () => false,
    );
    if (dbOk) latencyMs = Math.round(performance.now() - started);
    const since = new Date(now.getTime() - days(1));
    const db = this.prisma;
    const mailWhere = (status: string) => ({ status, createdAt: { gte: since } });
    const [mailQueued, mailSent, mailFailed, mailNotSent, mailRecent] = dbOk
      ? await this.sys(() =>
          Promise.all([
            db.emailMessage.count({ where: { status: { in: ["queued", "sending"] } } }),
            db.emailMessage.count({ where: mailWhere("sent") }),
            db.emailMessage.count({ where: mailWhere("failed") }),
            db.emailMessage.count({ where: mailWhere("not_sent") }),
            db.emailMessage.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { id: true, to: true, subject: true, template: true, status: true, error: true, createdAt: true } }),
          ]),
        )
      : [0, 0, 0, 0, []];
    const [received24h, failed24h, recentErrors, connected, errored] = dbOk
      ? await this.sys(() =>
          Promise.all([
            db.webhookEvent.count({ where: { receivedAt: { gte: since } } }),
            db.webhookEvent.count({ where: { receivedAt: { gte: since }, error: { not: null } } }),
            db.webhookEvent.findMany({ where: { error: { not: null } }, orderBy: { receivedAt: "desc" }, take: 10, select: { id: true, provider: true, error: true, receivedAt: true } }),
            db.channel.count({ where: { status: "connected" } }),
            db.channel.findMany({ where: { status: "error" }, take: 20, include: { tenant: { select: { name: true } } } }),
          ]),
        )
      : [0, 0, [], 0, []];
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
