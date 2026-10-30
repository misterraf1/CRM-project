"use client";

import type { BillingInterval, BillingOverviewDto, CheckoutResponse, PlanDto } from "@/shared";
import clsx from "clsx";
import { Check, CreditCard, FlaskConical, Info, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { DemoBadge } from "@/components/ui/Card";
import { api } from "@/lib/api/client";
import { INVOICE_STATUS_STYLE, SUBSCRIPTION_STATUS_STYLE } from "@/lib/billing";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";


const price = (p: PlanDto, interval: BillingInterval) => (interval === "YEAR" ? p.priceYearly : p.priceMonthly);

/** `limit` null = unlimited: the bar stays empty and says so. */
function Meter({ label, used, limit, unit, unlimited }: { label: string; used: number; limit: number | null; unit: string; unlimited?: string }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-fg-muted">{label}</span>
        <span className="tabular font-medium">
          {used} / {limit ?? unlimited} {limit !== null && unit}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit ?? undefined}>
        <div className={clsx("h-full rounded-full", pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function BillingManager({ data, paid }: { data: BillingOverviewDto; paid: boolean }) {
  const { t, locale } = useI18n();
  const b = t.billing;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string | undefined>(paid ? b.paidNotice : undefined);
  const sub = data.subscription;
  const [interval, setInterval] = useState<BillingInterval>(sub.interval);
  const [nextFails, setNextFails] = useState(sub.demoNextChargeFails);
  const date = (iso: string) => formatDate(iso, locale, "long");
  const money = (n: number) => formatMoney(n, locale, sub.plan.currency);

  const run = (fn: () => Promise<{ ok: boolean; code?: string; details?: unknown; data?: unknown }>, onOk?: (data: unknown) => void, onFail?: () => void) =>
    startTransition(async () => {
      setError(undefined);
      setNotice(undefined);
      const res = await fn();
      if (!res.ok) {
        setError(errorMessage(t, res.code, res.details));
        onFail?.();
      } else onOk?.(res.data);
      router.refresh();
    });

  /** Checkout responses carry the hosted payment page to go to. */
  const go = (d: unknown) => {
    const r = d as CheckoutResponse | { applied: true };
    if ("redirectUrl" in r) window.location.assign(new URL(r.redirectUrl).pathname + new URL(r.redirectUrl).search);
    else setNotice(b.addonsSaved);
  };

  const active = sub.status === "ACTIVE";
  const currentMonthly = sub.plan.priceMonthly;
  // The platform manages the subscription: no checkout, no card, plan changes through support
  const manual = data.provider === "manual";

  function planAction(p: PlanDto) {
    const isCurrent = p.code === sub.plan.code && (!active || interval === sub.interval);
    if (active && p.code === sub.plan.code && interval === sub.interval) return { label: b.current, disabled: true, kind: "none" as const };
    if (active && interval === sub.interval && p.priceMonthly < currentMonthly) return { label: b.downgrade, disabled: sub.scheduledPlan === p.code, kind: "downgrade" as const };
    return { label: active && p.priceMonthly > currentMonthly ? b.upgrade : b.choose, disabled: false, kind: "checkout" as const, isCurrent };
  }

  function addons(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(() => api("/billing/addons", "POST", { extraSeats: Number(f.get("extraSeats")), extraStorageGb: Number(f.get("extraStorageGb")) }), go);
  }

  return (
    <div className="space-y-5" aria-busy={pending}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{b.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{b.subtitle}</p>
      </div>
      {data.provider === "demo" && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {b.demoBanner}
        </p>
      )}
      {manual && (
        <p className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft/60 px-3 py-2 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span>
            {b.manualBanner}{" "}
            <Link href="/support" className="font-medium text-accent hover:underline">
              {b.contactSupport}
            </Link>
          </span>
        </p>
      )}
      {notice && <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{b.currentPlan}</h2>
            <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", SUBSCRIPTION_STATUS_STYLE[sub.status])}>{b.statuses[sub.status]}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight">
            {sub.plan.name}{" "}
            <span className="text-base font-normal text-fg-muted">
              {money(price(sub.plan, sub.interval))}
              {sub.interval === "YEAR" ? b.perYear : b.perMonth}
            </span>
          </p>
          <p className={clsx("mt-1 text-sm", sub.status === "PAST_DUE" || sub.status === "SUSPENDED" ? "text-danger" : "text-fg-muted")}>
            {sub.status === "TRIALING" && sub.trialEndsAt
              ? interpolate(b.trialEnds, { date: date(sub.trialEndsAt) })
              : sub.status === "PAST_DUE" && sub.graceEndsAt
                ? interpolate(manual ? b.manualGrace : b.graceUntil, { date: date(sub.graceEndsAt) })
                : sub.status === "SUSPENDED" || sub.status === "CANCELED"
                  ? manual
                    ? b.manualSuspended
                    : b.suspendedHint
                  : sub.cancelAtPeriodEnd
                    ? interpolate(b.endsOn, { date: date(sub.currentPeriodEnd) })
                    : interpolate(manual ? b.paidUntil : b.renews, { date: date(sub.currentPeriodEnd) })}
          </p>
          {sub.scheduledPlan && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              {interpolate(b.scheduled, { plan: sub.scheduledPlan, date: date(sub.currentPeriodEnd) })}
              <button type="button" onClick={() => run(() => api("/billing/downgrade", "DELETE"))} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                <Undo2 className="h-3.5 w-3.5" aria-hidden />
                {b.undoScheduled}
              </button>
            </p>
          )}
          <div className={manual ? "hidden" : "mt-4 flex items-center gap-2 text-sm"}>
            <CreditCard className="h-4 w-4 text-fg-subtle" aria-hidden />
            <span className="text-fg-muted">{b.paymentMethod}:</span>
            {sub.paymentMethod ? (
              <span className="font-medium">
                {sub.paymentMethod.brand} •••• {sub.paymentMethod.last4}
              </span>
            ) : (
              <span className="text-fg-subtle">{b.noPaymentMethod}</span>
            )}
            {data.provider === "demo" && <DemoBadge label={t.common.demo} />}
          </div>
          {active && (
            <div className="mt-4">
              {sub.cancelAtPeriodEnd ? (
                <button type="button" onClick={() => run(() => api("/billing/resume", "POST"))} className="btn-ghost h-8 border border-border text-xs">
                  {b.resume}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => window.confirm(interpolate(b.confirmCancel, { date: date(sub.currentPeriodEnd) })) && run(() => api("/billing/cancel", "POST"))}
                  className="btn-danger h-8 text-xs"
                >
                  {b.cancel}
                </button>
              )}
            </div>
          )}
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold">{b.usage}</h2>
          <Meter label={b.seats} used={data.usage.seats.used} limit={data.usage.seats.limit} unit="" />
          <Meter label={b.storage} used={Math.round(data.usage.storageMb.used / 102.4) / 10} limit={Math.round(data.usage.storageMb.limit / 1024)} unit="GB" />
          <Meter label={b.contactsUsage} used={data.usage.contacts.used} limit={data.usage.contacts.limit} unit="" unlimited={b.unlimited} />
          <Meter label={b.automationsUsage} used={data.usage.automations.used} limit={data.usage.automations.limit} unit="" unlimited={b.unlimited} />
        </section>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{b.seePlans}</h2>
          {manual && <p className="w-full text-xs text-fg-muted sm:order-last">{b.manualPlans}</p>}
          <div role="radiogroup" aria-label={`${b.monthly} / ${b.yearly}`} className="flex rounded-lg bg-muted p-0.5 text-xs font-medium">
            {(["MONTH", "YEAR"] as const).map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={interval === i}
                onClick={() => setInterval(i)}
                className={clsx("rounded-md px-3 py-1.5", interval === i ? "bg-surface text-fg shadow-sm" : "text-fg-muted")}
              >
                {i === "MONTH" ? b.monthly : b.yearly}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {data.plans.map((p) => {
            const action = planAction(p);
            const mine = p.code === sub.plan.code;
            return (
              <article key={p.code} aria-label={p.name} className={clsx("card flex flex-col p-5", mine && "border-accent ring-1 ring-accent/30")}>
                <h3 className="text-base font-semibold">{p.name}</h3>
                <p className="mt-1">
                  <span className="tabular text-2xl font-semibold">{money(price(p, interval))}</span>
                  <span className="text-sm text-fg-muted">{interval === "YEAR" ? b.perYear : b.perMonth}</span>
                </p>
                <p className="mt-1 text-xs text-fg-subtle">
                  {interpolate(b.seatsLimit, { n: p.seatLimit })} · {interpolate(b.storageLimit, { n: formatNumber(p.storageMb / 1024, locale) })}
                </p>
                {p.aiCredits > 0 && <p className="mt-0.5 text-xs text-fg-subtle">{interpolate(b.aiCredits, { n: formatNumber(p.aiCredits, locale) })}</p>}
                {(p.contactLimit !== null || p.automationLimit !== null) && (
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {[
                      p.contactLimit !== null && interpolate(b.contactLimit, { n: formatNumber(p.contactLimit, locale) }),
                      p.automationLimit !== null && interpolate(b.automationLimit, { n: formatNumber(p.automationLimit, locale) }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <ul className="mt-3 flex-1 space-y-1.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                      {b.features[f as keyof typeof b.features] ?? f}
                    </li>
                  ))}
                </ul>
                {mine && manual && <p className="mt-4 text-center text-xs font-medium text-accent">{b.current}</p>}
                {!manual && (
                  <button
                    type="button"
                    disabled={pending || action.disabled}
                    onClick={() => {
                      if (action.kind === "downgrade") {
                        if (window.confirm(interpolate(b.confirmDowngrade, { plan: p.name, date: date(sub.currentPeriodEnd) }))) {
                          run(() => api("/billing/downgrade", "POST", { planCode: p.code }));
                        }
                      } else if (action.kind === "checkout") {
                        run(() => api<CheckoutResponse>("/billing/checkout", "POST", { planCode: p.code, interval }), go);
                      }
                    }}
                    className={clsx("mt-4", action.kind === "checkout" ? "btn-primary" : "btn-ghost border border-border")}
                  >
                    {action.label}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <div className={manual ? "hidden" : "grid gap-5 lg:grid-cols-2"}>
        <section className="card p-5">
          <h2 className="text-sm font-semibold">{b.addons}</h2>
          <form onSubmit={addons} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="field-label">
              {interpolate(b.extraSeats, { price: money(sub.plan.extraSeatPrice) })}
              <input name="extraSeats" type="number" min={0} max={500} defaultValue={sub.extraSeats} className="input" />
            </label>
            <label className="field-label">
              {interpolate(b.extraStorage, { price: money(sub.plan.extraStorageGbPrice) })}
              <input name="extraStorageGb" type="number" min={0} max={1000} defaultValue={sub.extraStorageGb} className="input" />
            </label>
            <button type="submit" disabled={pending || !["TRIALING", "ACTIVE"].includes(sub.status)} className="btn-primary">
              {b.applyAddons}
            </button>
          </form>
        </section>

        {data.provider === "demo" && (
          <section className="card border-warning/30 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <FlaskConical className="h-4 w-4 text-warning" aria-hidden />
              {b.demoTools}
            </h2>
            <p className="mt-1 text-xs text-fg-subtle">{b.demoToolsHint}</p>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={nextFails}
                disabled={pending}
                onChange={(e) => {
                  const fails = e.target.checked;
                  setNextFails(fails);
                  run(() => api("/billing/demo/next-charge", "POST", { fails }), undefined, () => setNextFails(!fails));
                }}
              />
              {b.nextChargeFails}
            </label>
            <button type="button" disabled={pending} onClick={() => run(() => api("/billing/demo/advance", "POST"))} className="btn-ghost mt-3 h-8 border border-warning/40 text-xs">
              {b.advance}
            </button>
            <p className="mt-1 text-[11px] text-fg-subtle">{b.advanceHint}</p>
          </section>
        )}
      </div>

      <section className="card">
        <h2 className="px-5 pt-4 text-sm font-semibold">{b.invoices}</h2>
        {data.invoices.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-muted">{b.noInvoices}</p>
        ) : (
          <div className="relative mt-2 overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-y border-border text-left text-xs text-fg-subtle">
                  <th scope="col" className="px-5 py-2 font-medium">№</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t.invoice.issued}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t.invoice.description}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t.invoice.amount}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t.invoice.status}</th>
                  <th scope="col" className="px-5 py-2"><span className="sr-only">{b.view}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-5 py-2.5 font-mono text-xs">{inv.number}</td>
                    <td className="px-3 text-xs text-fg-muted">{formatDate(inv.createdAt, locale, "short")}</td>
                    <td className="px-3">{b.invoiceKinds[inv.kind]}</td>
                    <td className="tabular px-3 text-right font-medium">{money(inv.amount)}</td>
                    <td className="px-3">
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          INVOICE_STATUS_STYLE[inv.status] ?? "bg-muted text-fg-muted",
                        )}
                      >
                        {b.invoiceStatuses[inv.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 text-right">
                      {!manual && (inv.status === "OPEN" || inv.status === "FAILED") && (
                        <button type="button" onClick={() => run(() => api<CheckoutResponse>(`/billing/invoices/${inv.id}/pay`, "POST"), go)} className="mr-3 text-xs font-medium text-accent hover:underline">
                          {b.payNow}
                        </button>
                      )}
                      <Link href={`/settings/billing/invoices/${inv.id}`} className="text-xs font-medium text-fg-muted hover:text-fg">
                        {b.view}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
