import type { Invoice, Plan, Subscription } from "../db/models";
import type { BillingInterval, InvoiceLineDto } from "@/shared";
import { config } from "../config";
import { JobsMonitor } from "../common/jobs-monitor";
import { randomToken } from "../common/ids";
import { NotificationsService } from "../notifications/notifications.service";
import type { Database, Tx } from "../db/database";
import { BillingService, ownerIds } from "./billing.service";
import { subscriptionOf } from "./entitlements.service";
import { nextInvoiceNumber, type InvoiceApply } from "./invoices";
import { addInterval, addonsPrice, days, planPrice, storageGb } from "./pricing";
import type { PaymentProvider } from "./provider";

const EVERY_MS = 10 * 60_000;
const TRIAL_REMINDER_DAYS = 3;
/** Renewal retries after a failed charge, in days from the failure */
const RETRY_DAYS = [1, 3, 5];

type Sub = Subscription & { plan: Plan };

/**
 * Subscription lifecycle (docs/ARCHITECTURE.md §8.2):
 *   TRIALING ─ trial ends unpaid ─▶ SUSPENDED
 *   ACTIVE ─ period ends ─▶ renew: charge saved card ─ ok ─▶ ACTIVE (next period)
 *                                                  └ fail ─▶ PAST_DUE (grace, retries on days 1/3/5)
 *   PAST_DUE ─ retry ok ─▶ ACTIVE   ·   grace over ─▶ SUSPENDED (read-only)
 *   ACTIVE + cancelAtPeriodEnd ─ period ends ─▶ CANCELED (read-only)
 * Scheduled downgrades switch the plan right before the renewal charge.
 */
export class BillingJob {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Database,
    private readonly monitor: JobsMonitor,
    private readonly billing: BillingService,
    private readonly notifications: NotificationsService,
    private readonly provider: PaymentProvider,
  ) {}

  start() {
    this.monitor.register("billing");
    if (!config().JOBS_ENABLED) return;
    const tick = () => this.monitor.track("billing", () => this.run());
    this.timer = setInterval(tick, EVERY_MS);
    void tick();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Processes every subscription with something due. Returns how many were handled. */
  async run(now = new Date()): Promise<number> {
    const soon = new Date(now.getTime() + days(TRIAL_REMINDER_DAYS));
    const due = await this.db.system.subscription.find(
      {
        $or: [
          { status: "TRIALING", trialEndsAt: { $lte: soon, $ne: null } },
          { status: "ACTIVE", currentPeriodEnd: { $lte: now } },
          { status: "PAST_DUE", $or: [{ graceEndsAt: { $lte: now, $ne: null } }, { nextRetryAt: { $lte: now, $ne: null } }] },
        ],
      },
      { projection: { tenantId: 1 }, limit: 500 },
    );
    for (const { tenantId } of due) await this.processTenant(tenantId, now);
    return due.length;
  }

  async processTenant(tenantId: string, now = new Date()) {
    await this.db.scoped(
      async (tx) => {
        const sub = await subscriptionOf(tx, tenantId);
        if (sub.status === "TRIALING") await this.trial(tx, sub, now);
        else if (sub.status === "ACTIVE" && sub.currentPeriodEnd <= now) await this.periodEnd(tx, sub, now);
        else if (sub.status === "PAST_DUE") await this.dunning(tx, sub, now);
      },
      { tenantId },
    );
  }

  private async trial(tx: Tx, sub: Sub, now: Date) {
    if (!sub.trialEndsAt) return;
    if (sub.trialEndsAt <= now) {
      await this.setStatus(tx, sub, "SUSPENDED");
      await this.notifications.notify(tx, sub.tenantId, await ownerIds(tx, sub.tenantId), "billing_suspended", { reason: "trial_ended" });
    } else if (!sub.trialReminderSentAt) {
      await tx.subscription.update({ id: sub.id }, { $set: { trialReminderSentAt: now } });
      await this.notifications.notify(tx, sub.tenantId, await ownerIds(tx, sub.tenantId), "billing_trial_ending", { trialEndsAt: sub.trialEndsAt.toISOString() });
    }
  }

  private async periodEnd(tx: Tx, sub: Sub, now: Date) {
    if (sub.cancelAtPeriodEnd) {
      await this.setStatus(tx, sub, "CANCELED");
      return;
    }
    let plan = sub.plan;
    if (sub.scheduledPlanId) {
      plan = await tx.plan.get({ id: sub.scheduledPlanId });
      await tx.subscription.update({ id: sub.id }, { $set: { planId: plan.id, scheduledPlanId: null } });
    }
    const interval = sub.interval as BillingInterval;
    const periodStart = sub.currentPeriodEnd;
    const periodEnd = addInterval(periodStart, interval);
    const gb = storageGb(sub.extraStorageMb);
    const lines: InvoiceLineDto[] = [{ code: "plan", plan: plan.code, interval, quantity: 1, unitAmount: planPrice(plan, interval), amount: planPrice(plan, interval) }];
    const addons = addonsPrice(plan, sub.extraSeats, gb, interval);
    if (addons) lines.push({ code: "addons", interval, quantity: 1, unitAmount: addons, amount: addons });
    const invoice = await tx.invoice.insertOne({
      tenantId: sub.tenantId,
      number: await nextInvoiceNumber(tx, now),
      kind: "renewal",
      status: "OPEN",
      amount: lines.reduce((a, l) => a + l.amount, 0),
      currency: plan.currency,
      periodStart,
      periodEnd,
      lines: lines as unknown as Invoice["lines"],
      apply: { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() } satisfies InvoiceApply as Invoice["apply"],
    });
    const charged = await this.charge(tx, { ...sub, plan }, invoice.id);
    if (!charged) {
      await tx.subscription.update(
        { id: sub.id },
        { $set: { status: "PAST_DUE", graceEndsAt: new Date(now.getTime() + days(config().GRACE_DAYS)), retryCount: 0, nextRetryAt: new Date(now.getTime() + days(RETRY_DAYS[0]!)) } },
      );
      await tx.tenant.update({ id: sub.tenantId }, { $set: { status: "PAST_DUE" } });
      await this.notifications.notify(tx, sub.tenantId, await ownerIds(tx, sub.tenantId), "billing_payment_failed", { invoiceId: invoice.id, number: invoice.number, amount: invoice.amount });
    }
  }

  private async dunning(tx: Tx, sub: Sub, now: Date) {
    if (sub.graceEndsAt && sub.graceEndsAt <= now) {
      await this.setStatus(tx, sub, "SUSPENDED");
      await this.notifications.notify(tx, sub.tenantId, await ownerIds(tx, sub.tenantId), "billing_suspended", { reason: "payment_failed" });
      return;
    }
    if (!sub.nextRetryAt || sub.nextRetryAt > now) return;
    const invoice = await tx.invoice.findOne({ tenantId: sub.tenantId, kind: "renewal", status: { $in: ["OPEN", "FAILED"] } }, { sort: { createdAt: -1 } });
    if (!invoice) return;
    if (await this.charge(tx, sub, invoice.id)) return;
    const attempt = sub.retryCount + 1;
    const failedAt = sub.graceEndsAt ? new Date(sub.graceEndsAt.getTime() - days(config().GRACE_DAYS)) : now;
    const next = RETRY_DAYS[attempt];
    await tx.subscription.update({ id: sub.id }, { $set: { retryCount: attempt, nextRetryAt: next === undefined ? null : new Date(failedAt.getTime() + days(next)) } });
  }

  /** Charges the saved payment method for an invoice; true when paid. */
  private async charge(tx: Tx, sub: Sub, invoiceId: string) {
    const invoice = await tx.invoice.get({ id: invoiceId });
    const result = await this.provider.chargeSaved(sub, invoice);
    if (result.ok) {
      await this.billing.markPaid(tx, sub, invoice, this.provider.name, result.providerRef);
      return true;
    }
    await tx.payment.insertOne({
      tenantId: sub.tenantId,
      invoiceId,
      provider: this.provider.name,
      providerRef: result.providerRef || `fail_${randomToken(6)}`,
      amount: invoice.amount,
      status: "failed",
      failureCode: result.failureCode ?? "declined",
    });
    await tx.invoice.update({ id: invoiceId }, { $set: { status: "FAILED" } });
    return false;
  }

  private async setStatus(tx: Tx, sub: Sub, status: "SUSPENDED" | "CANCELED") {
    await tx.subscription.update({ id: sub.id }, { $set: { status, nextRetryAt: null } });
    await tx.tenant.update({ id: sub.tenantId }, { $set: { status } });
  }

  /**
   * DEMO provider only: pretend the next due date (trial end, period end, retry,
   * grace end) is now and process it — to try the whole lifecycle in minutes.
   */
  async demoAdvance(tenantId: string) {
    if (this.provider.name !== "demo") return;
    const now = new Date();
    const past = new Date(now.getTime() - 1000);
    await this.db.scoped(
      async (tx) => {
        const sub = await tx.subscription.get({ tenantId });
        const data: Partial<Subscription> =
          sub.status === "TRIALING"
            ? { trialEndsAt: past }
            : sub.status === "ACTIVE"
              ? { currentPeriodEnd: past }
              : sub.status === "PAST_DUE"
                ? sub.nextRetryAt
                  ? { nextRetryAt: past }
                  : { graceEndsAt: past }
                : {};
        await tx.subscription.update({ id: sub.id }, { $set: data });
      },
      { tenantId },
    );
    await this.processTenant(tenantId, now);
  }
}
