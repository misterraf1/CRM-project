import type { Invoice, Plan, Subscription } from "../db/models";
import type { AddonsInput, BillingInterval, BillingOverviewDto, CheckoutInput, CheckoutResponse, InvoiceDto, InvoiceLineDto, PlanDto } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { config } from "../config";
import { MailService } from "../mail/mail.service";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { randomToken } from "../common/ids";
import { NotificationsService } from "../notifications/notifications.service";
import type { Database, Tx } from "../db/database";
import { EntitlementsService, subscriptionOf } from "./entitlements.service";
import { nextInvoiceNumber, toInvoiceDto, withPayments, type InvoiceApply } from "./invoices";
import { addInterval, addonsPrice, planPrice, remainingFraction, storageGb } from "./pricing";
import type { PaymentProvider } from "./provider";

type SubWithPlan = Subscription & { plan: Plan };

export function toPlanDto(p: Plan): PlanDto {
  return {
    code: p.code,
    name: p.name,
    priceMonthly: p.priceMonthly,
    priceYearly: p.priceYearly,
    currency: p.currency,
    seatLimit: p.seatLimit,
    storageMb: p.storageMb,
    features: p.features,
    extraSeatPrice: p.extraSeatPrice,
    extraStorageGbPrice: p.extraStorageGbPrice,
    aiCredits: p.aiCredits,
  };
}

/** Owners of a tenant: they receive billing notices. */
export async function ownerIds(tx: Tx, tenantId: string) {
  return (await tx.membership.find({ tenantId, role: "OWNER", status: "ACTIVE" }, { projection: { id: 1 } })).map((m) => m.id);
}

export class BillingService {
  constructor(
    private readonly db: Database,
    private readonly entitlements: EntitlementsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly provider: PaymentProvider,
  ) {}

  async overview(): Promise<BillingOverviewDto> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const [sub, plans, invoices, seats, storage, tenant] = await Promise.all([
        this.subscription(tx, tenantId),
        tx.plan.find({ isPublic: true }, { sort: { sortOrder: 1 } }),
        tx.invoice.find({ tenantId, status: { $ne: "VOID" } }, { sort: { createdAt: -1 }, limit: 50 }).then((rows) => withPayments(tx, rows)),
        this.entitlements.seats(tx, tenantId),
        this.entitlements.storage(tx, tenantId),
        tx.tenant.get({ id: tenantId }, { projection: { name: 1 } }).then((t) => ({ name: t.name })),
      ]);
      const scheduled = sub.scheduledPlanId ? plans.find((p) => p.id === sub.scheduledPlanId) : undefined;
      return {
        provider: this.provider.name,
        subscription: {
          plan: toPlanDto(sub.plan),
          status: sub.status,
          interval: sub.interval,
          trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
          currentPeriodStart: sub.currentPeriodStart.toISOString(),
          currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
          graceEndsAt: sub.graceEndsAt?.toISOString() ?? null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          scheduledPlan: scheduled?.code ?? null,
          extraSeats: sub.extraSeats,
          extraStorageGb: storageGb(sub.extraStorageMb),
          paymentMethod: (sub.paymentMethod as { brand: string; last4: string } | null) ?? null,
          demoNextChargeFails: sub.demoNextChargeFails,
        },
        usage: { seats, storageMb: storage },
        plans: plans.map(toPlanDto),
        invoices: invoices.map(toInvoiceDto),
        company: tenant,
      };
    });
  }

  /**
   * Starts a payment for a plan:
   * - not active yet (trial, past due, suspended, canceled): a new period starting at payment
   * - active, same interval, more expensive plan: upgrade now, prorated for the rest of the period
   * - active, other interval: a new period now, minus credit for the unused time
   * Cheaper plans go through `downgrade` (applied at period end).
   */
  async checkout(input: CheckoutInput): Promise<CheckoutResponse> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const sub = await this.subscription(tx, ctx.tenantId);
      const plan = await tx.plan.findOne({ code: input.planCode, isPublic: true });
      if (!plan) throw new AppError("VALIDATION_FAILED", "Unknown plan", { planCode: ["Unknown plan"] });
      await this.assertSeatsFit(tx, ctx.tenantId, plan, sub.extraSeats);

      const now = new Date();
      const lines: InvoiceLineDto[] = [];
      let apply: InvoiceApply;
      let kind: "subscription" | "upgrade";
      let periodStart = now;
      let periodEnd = addInterval(now, input.interval);
      const extraGb = storageGb(sub.extraStorageMb);
      const newPrice = planPrice(plan, input.interval);
      const newAddons = addonsPrice(plan, sub.extraSeats, extraGb, input.interval);

      if (sub.status === "ACTIVE" && input.interval === sub.interval) {
        const oldPrice = planPrice(sub.plan, sub.interval);
        if (plan.id === sub.planId) throw new AppError("CONFLICT", "Already on this plan");
        if (newPrice < oldPrice) throw new AppError("CONFLICT", "Use a downgrade for a cheaper plan", { downgrade: true });
        const share = remainingFraction(sub.currentPeriodStart, sub.currentPeriodEnd, now);
        const amount = Math.round((newPrice - oldPrice) * share);
        lines.push({ code: "plan_upgrade", plan: plan.code, interval: input.interval, quantity: 1, unitAmount: amount, amount });
        apply = { planId: plan.id };
        kind = "upgrade";
        periodStart = now;
        periodEnd = sub.currentPeriodEnd;
      } else {
        lines.push({ code: "plan", plan: plan.code, interval: input.interval, quantity: 1, unitAmount: newPrice, amount: newPrice });
        if (sub.extraSeats) lines.push(this.addonLine("extra_seats", sub.extraSeats, plan.extraSeatPrice, input.interval));
        if (extraGb) lines.push(this.addonLine("extra_storage", extraGb, plan.extraStorageGbPrice, input.interval));
        if (sub.status === "ACTIVE") {
          // Interval change: credit what is left of the current paid period
          const oldTotal = planPrice(sub.plan, sub.interval) + addonsPrice(sub.plan, sub.extraSeats, extraGb, sub.interval);
          const credit = Math.min(newPrice + newAddons, Math.round(oldTotal * remainingFraction(sub.currentPeriodStart, sub.currentPeriodEnd, now)));
          if (credit > 0) lines.push({ code: "proration_credit", quantity: 1, unitAmount: -credit, amount: -credit });
        }
        apply = { planId: plan.id, interval: input.interval, newPeriod: true };
        kind = "subscription";
      }

      // Only one pending checkout at a time
      await tx.invoice.updateMany({ tenantId: ctx.tenantId, status: "OPEN", kind: { $in: ["subscription", "upgrade", "addons"] } }, { $set: { status: "VOID" } });
      const amount = Math.max(0, lines.reduce((a, l) => a + l.amount, 0));
      const invoice = await tx.invoice.insertOne({
        tenantId: ctx.tenantId,
        number: await nextInvoiceNumber(tx, now),
        kind,
        status: "OPEN",
        amount,
        currency: plan.currency,
        periodStart,
        periodEnd,
        lines: lines as unknown as Invoice["lines"],
        apply: apply as Invoice["apply"],
      });
      await this.audit.log(tx, { action: "billing.checkout", entityType: "invoice", entityId: invoice.id, diff: { plan: plan.code, interval: input.interval, amount } });

      if (amount === 0) {
        // Fully covered by credit: nothing to charge
        const paid = await this.markPaid(tx, sub, invoice, "credit", `credit_${randomToken(6)}`);
        return { invoice: toInvoiceDto(paid), redirectUrl: `${config().WEB_ORIGIN}/settings/billing?paid=1` };
      }
      return { invoice: toInvoiceDto(invoice), redirectUrl: this.provider.checkoutUrl(invoice) };
    });
  }

  /** Re-opens an unpaid invoice (e.g. a failed renewal) for payment on the hosted page. */
  async pay(invoiceId: string): Promise<CheckoutResponse> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const invoice = await tx.invoice.findOne({ id: invoiceId, tenantId });
      if (!invoice || !["OPEN", "FAILED"].includes(invoice.status)) throw notFound("Invoice");
      const [open] = await withPayments(tx, [await tx.invoice.update({ id: invoice.id }, { $set: { status: "OPEN" } })]);
      return { invoice: toInvoiceDto(open!), redirectUrl: this.provider.checkoutUrl(open!) };
    });
  }

  async invoice(invoiceId: string): Promise<InvoiceDto & { company: string; plan: string }> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const found = await tx.invoice.findOne({ id: invoiceId, tenantId });
      if (!found) throw notFound("Invoice");
      const [[invoice], tenant, sub] = await Promise.all([withPayments(tx, [found]), tx.tenant.get({ id: tenantId }), this.subscription(tx, tenantId)]);
      return { ...toInvoiceDto(invoice!), company: tenant.name, plan: sub.plan.code };
    });
  }

  /** Cheaper plan from the next period; members beyond the new limit must be disabled first. */
  async downgrade(planCode: string) {
    const { tenantId } = authedContext();
    await this.db.scoped(async (tx) => {
      const sub = await this.subscription(tx, tenantId);
      if (sub.status !== "ACTIVE") throw new AppError("CONFLICT", "Only active subscriptions can be downgraded; choose a plan at checkout instead");
      const plan = await tx.plan.findOne({ code: planCode, isPublic: true });
      if (!plan) throw new AppError("VALIDATION_FAILED", "Unknown plan", { planCode: ["Unknown plan"] });
      if (planPrice(plan, sub.interval) >= planPrice(sub.plan, sub.interval)) throw new AppError("CONFLICT", "Not a cheaper plan");
      await this.assertSeatsFit(tx, tenantId, plan, sub.extraSeats);
      await tx.subscription.update({ id: sub.id }, { $set: { scheduledPlanId: plan.id } });
      await this.audit.log(tx, { action: "billing.downgrade_scheduled", entityType: "subscription", entityId: sub.id, diff: { from: sub.plan.code, to: plan.code } });
    });
  }

  async cancelDowngrade() {
    const { tenantId } = authedContext();
    await this.db.scoped((tx) => tx.subscription.updateMany({ tenantId }, { $set: { scheduledPlanId: null } }));
  }

  async setCancelAtPeriodEnd(cancel: boolean) {
    const { tenantId } = authedContext();
    await this.db.scoped(async (tx) => {
      const sub = await this.subscription(tx, tenantId);
      if (sub.status !== "ACTIVE") throw new AppError("CONFLICT", "Only an active subscription can be canceled or resumed");
      await tx.subscription.update({ id: sub.id }, { $set: { cancelAtPeriodEnd: cancel } });
      await this.audit.log(tx, { action: cancel ? "billing.cancel_scheduled" : "billing.resumed", entityType: "subscription", entityId: sub.id });
    });
  }

  /**
   * Extra seats/storage. Reductions apply immediately (no refund) if usage fits;
   * increases are free during the trial and prorated on an active subscription.
   */
  async addons(input: AddonsInput): Promise<CheckoutResponse | { applied: true }> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const sub = await this.subscription(tx, ctx.tenantId);
      if (!["TRIALING", "ACTIVE"].includes(sub.status)) throw new AppError("SUBSCRIPTION_INACTIVE", "Reactivate the subscription first");
      await this.assertSeatsFit(tx, ctx.tenantId, sub.plan, input.extraSeats);
      const storage = await this.entitlements.storage(tx, ctx.tenantId);
      if (storage.used > sub.plan.storageMb + input.extraStorageGb * 1024) {
        throw new AppError("STORAGE_LIMIT", "Stored files exceed the new limit", { usedMb: storage.used, limitMb: sub.plan.storageMb + input.extraStorageGb * 1024 });
      }
      const oldGb = storageGb(sub.extraStorageMb);
      const delta = addonsPrice(sub.plan, input.extraSeats, input.extraStorageGb, sub.interval) - addonsPrice(sub.plan, sub.extraSeats, oldGb, sub.interval);
      const apply: InvoiceApply = { extraSeats: input.extraSeats, extraStorageMb: input.extraStorageGb * 1024 };

      if (sub.status === "TRIALING" || delta <= 0) {
        await tx.subscription.update({ id: sub.id }, { $set: { extraSeats: input.extraSeats, extraStorageMb: input.extraStorageGb * 1024 } });
        await this.audit.log(tx, { action: "billing.addons_changed", entityType: "subscription", entityId: sub.id, diff: { ...apply } });
        return { applied: true as const };
      }
      const now = new Date();
      const amount = Math.round(delta * remainingFraction(sub.currentPeriodStart, sub.currentPeriodEnd, now));
      const lines: InvoiceLineDto[] = [];
      if (input.extraSeats !== sub.extraSeats) lines.push(this.addonLine("extra_seats", input.extraSeats - sub.extraSeats, sub.plan.extraSeatPrice, sub.interval));
      if (input.extraStorageGb !== oldGb) lines.push(this.addonLine("extra_storage", input.extraStorageGb - oldGb, sub.plan.extraStorageGbPrice, sub.interval));
      lines.push({ code: "proration", quantity: 1, unitAmount: amount - lines.reduce((a, l) => a + l.amount, 0), amount: amount - lines.reduce((a, l) => a + l.amount, 0) });
      await tx.invoice.updateMany({ tenantId: ctx.tenantId, status: "OPEN", kind: { $in: ["subscription", "upgrade", "addons"] } }, { $set: { status: "VOID" } });
      const invoice = await tx.invoice.insertOne({
        tenantId: ctx.tenantId,
        number: await nextInvoiceNumber(tx, now),
        kind: "addons",
        status: "OPEN",
        amount,
        currency: sub.plan.currency,
        periodStart: now,
        periodEnd: sub.currentPeriodEnd,
        lines: lines as unknown as Invoice["lines"],
        apply: apply as Invoice["apply"],
      });
      return { invoice: toInvoiceDto(invoice), redirectUrl: this.provider.checkoutUrl(invoice) };
    });
  }

  /** DEMO provider: the hosted checkout page reports the customer's choice. */
  async demoComplete(invoiceId: string, outcome: "success" | "declined"): Promise<InvoiceDto> {
    this.assertDemo();
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const invoice = await tx.invoice.findOne({ id: invoiceId, tenantId });
      if (!invoice || invoice.status !== "OPEN") throw notFound("Invoice");
      const sub = await this.subscription(tx, tenantId);
      if (outcome === "declined") {
        // Like a real hosted page: the attempt is recorded and the customer can retry right away
        await tx.payment.insertOne({ tenantId, invoiceId, provider: "demo", providerRef: `demo_${randomToken(8)}`, amount: invoice.amount, status: "failed", failureCode: "card_declined" });
        const [open] = await withPayments(tx, [invoice]);
        return toInvoiceDto(open!);
      }
      // The demo "card" is what a real provider would tokenise on its own page
      await tx.subscription.update({ id: sub.id }, { $set: { paymentMethod: { brand: "Visa", last4: "4242" }, providerRef: `demo_card_${randomToken(6)}` } });
      const paid = await this.markPaid(tx, { ...sub, paymentMethod: { brand: "Visa", last4: "4242" } }, invoice, "demo", `demo_${randomToken(8)}`);
      return toInvoiceDto(paid);
    });
  }

  /** DEMO provider: make the next automatic charge fail (or succeed) to try dunning. */
  async demoNextCharge(fails: boolean) {
    this.assertDemo();
    const { tenantId } = authedContext();
    await this.db.scoped((tx) => tx.subscription.updateMany({ tenantId }, { $set: { demoNextChargeFails: fails } }));
  }

  /**
   * Records a successful payment and applies what the invoice was for. Shared by the
   * hosted checkout and automatic renewals, so both change the subscription the same way.
   */
  async markPaid(tx: Tx, sub: SubWithPlan | Subscription, invoice: Invoice, provider: string, providerRef: string) {
    const now = new Date();
    await tx.payment.insertOne({ tenantId: invoice.tenantId, invoiceId: invoice.id, provider, providerRef, amount: invoice.amount, status: "succeeded" });
    const [paid] = await withPayments(tx, [await tx.invoice.update({ id: invoice.id }, { $set: { status: "PAID", paidAt: now } })]);
    const a = (invoice.apply ?? {}) as InvoiceApply;
    const data: Partial<Subscription> = { status: "ACTIVE", graceEndsAt: null, retryCount: 0, nextRetryAt: null };
    if (a.planId) data.planId = a.planId;
    if (a.interval) data.interval = a.interval;
    if (a.newPeriod) {
      Object.assign(data, {
        currentPeriodStart: now,
        currentPeriodEnd: addInterval(now, (a.interval ?? sub.interval) as BillingInterval),
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        scheduledPlanId: null,
      });
    }
    if (a.periodStart && a.periodEnd) Object.assign(data, { currentPeriodStart: new Date(a.periodStart), currentPeriodEnd: new Date(a.periodEnd) });
    if (a.extraSeats !== undefined) data.extraSeats = a.extraSeats;
    if (a.extraStorageMb !== undefined) data.extraStorageMb = a.extraStorageMb;
    await tx.subscription.update({ id: sub.id }, { $set: data });
    await tx.tenant.update({ id: invoice.tenantId }, { $set: { status: "ACTIVE" } });
    await this.audit.log(tx, { action: "billing.paid", entityType: "invoice", entityId: invoice.id, diff: { amount: invoice.amount, kind: invoice.kind }, tenantId: invoice.tenantId });
    await this.notifications.notify(tx, invoice.tenantId, await ownerIds(tx, invoice.tenantId), "billing_paid", { invoiceId: invoice.id, number: invoice.number, amount: invoice.amount });
    // Receipt by email to the owners
    const [tenant, owners] = await Promise.all([
      tx.tenant.get({ id: invoice.tenantId }, { projection: { name: 1 } }),
      tx.membership.find({ tenantId: invoice.tenantId, role: "OWNER", status: "ACTIVE" }, { projection: { userId: 1 } }),
    ]);
    const users = await tx.user.find({ id: { $in: owners.map((o) => o.userId) } }, { projection: { email: 1, locale: 1 } });
    for (const u of users) {
      await this.mail.queue(tx, {
        tenantId: invoice.tenantId,
        to: u.email,
        locale: u.locale,
        template: "invoice_paid",
        vars: {
          company: tenant.name,
          number: invoice.number,
          amount: `${(invoice.amount / 100).toFixed(2)} ${invoice.currency}`,
          link: `${config().WEB_ORIGIN}/settings/billing/invoices/${invoice.id}`,
        },
      });
    }
    return paid!;
  }

  subscription(tx: Tx, tenantId: string): Promise<SubWithPlan> {
    return subscriptionOf(tx, tenantId);
  }

  private async assertSeatsFit(tx: Tx, tenantId: string, plan: Plan, extraSeats: number) {
    const { used } = await this.entitlements.seats(tx, tenantId);
    const limit = plan.seatLimit + extraSeats;
    if (used > limit) {
      throw new AppError("SEAT_LIMIT", `This plan allows ${limit} members; ${used} are active or invited`, { used, limit });
    }
  }

  private addonLine(code: "extra_seats" | "extra_storage", quantity: number, monthly: number, interval: BillingInterval): InvoiceLineDto {
    const unitAmount = interval === "YEAR" ? monthly * 10 : monthly;
    return { code, interval, quantity, unitAmount, amount: quantity * unitAmount };
  }

  private assertDemo() {
    if (this.provider.name !== "demo") throw notFound("Demo payments");
  }
}
