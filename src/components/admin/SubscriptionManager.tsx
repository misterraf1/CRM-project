"use client";

import { ALL_FEATURES, type AdminPlanDto, type AdminTenantDetail, type BillingInterval } from "@/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { adminApi } from "@/lib/api/client";
import { formatMoney, parseMoneyInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { useHydrated } from "@/lib/use-hydrated";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Default "paid through": one interval after the running period (or from today when it isn't running). */
function nextPeriodEnd(d: AdminTenantDetail, interval: BillingInterval) {
  const running = d.status === "ACTIVE" && new Date(d.subscription.currentPeriodEnd) > new Date();
  const from = running ? new Date(d.subscription.currentPeriodEnd) : new Date();
  if (interval === "YEAR") from.setUTCFullYear(from.getUTCFullYear() + 1);
  else from.setUTCMonth(from.getUTCMonth() + 1);
  return day(from);
}

type LimitMode = "plan" | "unlimited" | "custom";
const modeOf = (v: number | null | undefined): LimitMode => (v === undefined ? "plan" : v === null ? "unlimited" : "custom");

/**
 * Super Admin: sets a company's subscription by hand (after a bank transfer, or as a
 * gift) and its company-specific limits and extra features. Every change is audited.
 */
export function SubscriptionManager({ tenant: d, plans, canAct }: { tenant: AdminTenantDetail; plans: AdminPlanDto[]; canAct: boolean }) {
  const { t, locale } = useI18n();
  const k = t.admin.subscription;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const hydrated = useHydrated();
  const [planCode, setPlanCode] = useState(d.plan);
  const [interval, setInterval] = useState<BillingInterval>(d.interval);
  const [periodEnd, setPeriodEnd] = useState(() => nextPeriodEnd(d, d.interval));
  const plan = plans.find((p) => p.code === planCode);
  const listPrice = plan ? (interval === "YEAR" ? plan.priceYearly : plan.priceMonthly) : 0;
  const [contactMode, setContactMode] = useState<LimitMode>(modeOf(d.overrides.contactLimit));
  const [automationMode, setAutomationMode] = useState<LimitMode>(modeOf(d.overrides.automationLimit));

  // After a save the refreshed company data becomes the new starting point (the notice stays)
  useEffect(() => {
    setPlanCode(d.plan);
    setInterval(d.interval);
    setPeriodEnd(nextPeriodEnd(d, d.interval));
    setContactMode(modeOf(d.overrides.contactLimit));
    setAutomationMode(modeOf(d.overrides.automationLimit));
  }, [d]);

  const run = (path: string, body: object, done: string) =>
    startTransition(async () => {
      setError(undefined);
      setNotice(undefined);
      const res = await adminApi(path, "POST", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setNotice(done);
      router.refresh();
    });

  if (!canAct) return <p className="text-xs text-fg-subtle">{t.admin.readOnly}</p>;

  function activate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = parseMoneyInput(String(f.get("amount") || "0"));
    if (amount === null) return setError(t.errors.VALIDATION_FAILED);
    const confirmText = amount === 0 ? k.confirmGift : k.confirmPaid;
    if (!window.confirm(interpolate(confirmText, { company: d.name, plan: plan?.name ?? planCode, date: periodEnd, amount: formatMoney(amount, locale) }))) return;
    run(
      `/tenants/${d.id}/subscription`,
      {
        planCode,
        interval,
        periodEnd,
        amount,
        reference: String(f.get("reference") || "").trim() || undefined,
        note: String(f.get("note") || "").trim() || undefined,
      },
      k.activated,
    );
  }

  function saveLimits(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const optional = (name: string, scale = 1) => (String(f.get(name) ?? "").trim() === "" ? null : Math.round(Number(f.get(name)) * scale));
    const limit = (mode: LimitMode, name: string) => (mode === "plan" ? "plan" : mode === "unlimited" ? null : Number(f.get(name)));
    run(
      `/tenants/${d.id}/limits`,
      {
        seatLimit: optional("seatLimit"),
        storageMb: optional("storageGb", 1024),
        aiCredits: optional("aiCredits"),
        contactLimit: limit(contactMode, "contactLimit"),
        automationLimit: limit(automationMode, "automationLimit"),
        featureGrants: ALL_FEATURES.filter((feature) => f.get(`g:${feature}`) === "on").map((feature) => ({ feature, until: String(f.get(`u:${feature}`) || "") || null })),
      },
      k.limitsSaved,
    );
  }

  const planOf = plans.find((p) => p.code === d.plan);
  const grant = new Map(d.featureGrants.map((g) => [g.feature, g]));
  const limitSelect = (label: string, name: string, mode: LimitMode, setMode: (m: LimitMode) => void, planValue: number | null | undefined, value: number | null | undefined) => (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-fg-muted">{label}</legend>
      <div className="flex gap-2">
        <select aria-label={label} value={mode} onChange={(e) => setMode(e.target.value as LimitMode)} className="input mt-0 w-auto">
          <option value="plan">{interpolate(k.fromPlan, { value: planValue ?? k.unlimited })}</option>
          <option value="unlimited">{k.unlimited}</option>
          <option value="custom">{k.custom}</option>
        </select>
        {mode === "custom" && <input name={name} type="number" min={0} required defaultValue={value ?? ""} aria-label={`${label}: ${k.custom}`} className="input mt-0 w-28" />}
      </div>
    </fieldset>
  );

  return (
    <div className="space-y-5" aria-busy={pending}>
      {notice && <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      <form onSubmit={activate} className="space-y-3" aria-labelledby="sub-set-title">
        <h3 id="sub-set-title" className="text-sm font-semibold">{k.setTitle}</h3>
        <p className="text-xs text-fg-muted">{k.setHint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field-label">
            {k.plan}
            <select
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
              className="input"
            >
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                  {p.isPublic ? "" : ` (${k.private})`}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            {k.interval}
            <select
              value={interval}
              onChange={(e) => {
                const next = e.target.value as BillingInterval;
                setInterval(next);
                setPeriodEnd(nextPeriodEnd(d, next));
              }}
              className="input"
            >
              <option value="MONTH">{t.admin.tenants.intervals.MONTH}</option>
              <option value="YEAR">{t.admin.tenants.intervals.YEAR}</option>
            </select>
          </label>
          <label className="field-label">
            {k.periodEnd}
            <input type="date" required min={day(new Date(Date.now() + 86_400_000))} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="input" />
          </label>
          <label className="field-label">
            {k.amount}
            <input key={`${planCode}-${interval}`} name="amount" inputMode="decimal" defaultValue={(listPrice / 100).toFixed(2)} aria-describedby="sub-amount-hint" className="input" />
          </label>
          <label className="field-label">
            {k.reference}
            <input name="reference" maxLength={120} placeholder={k.referencePlaceholder} className="input" />
          </label>
          <label className="field-label">
            {k.note}
            <input name="note" maxLength={500} className="input" />
          </label>
        </div>
        <p id="sub-amount-hint" className="text-[11px] text-fg-subtle">
          {interpolate(k.amountHint, { price: formatMoney(listPrice, locale) })}
        </p>
        <button type="submit" disabled={pending || !hydrated} className="btn-primary">
          {k.activate}
        </button>
      </form>

      <form onSubmit={saveLimits} className="space-y-3 border-t border-border pt-5" aria-labelledby="sub-limits-title">
        <h3 id="sub-limits-title" className="text-sm font-semibold">{k.limitsTitle}</h3>
        <p className="text-xs text-fg-muted">{k.limitsHint}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="field-label">
            {t.admin.plans.seatLimit}
            <input name="seatLimit" type="number" min={1} defaultValue={d.overrides.seatLimit ?? ""} placeholder={interpolate(k.planValue, { value: planOf?.seatLimit ?? "" })} className="input" />
          </label>
          <label className="field-label">
            {t.admin.plans.storageGb}
            <input name="storageGb" type="number" min={0.1} step={0.1} defaultValue={d.overrides.storageMb !== undefined ? d.overrides.storageMb / 1024 : ""} placeholder={interpolate(k.planValue, { value: planOf ? planOf.storageMb / 1024 : "" })} className="input" />
          </label>
          <label className="field-label">
            {t.admin.plans.ai}
            <input name="aiCredits" type="number" min={0} defaultValue={d.overrides.aiCredits ?? ""} placeholder={interpolate(k.planValue, { value: planOf?.aiCredits ?? "" })} className="input" />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {limitSelect(t.admin.plans.contactLimit, "contactLimit", contactMode, setContactMode, planOf?.contactLimit, d.overrides.contactLimit)}
          {limitSelect(t.admin.plans.automationLimit, "automationLimit", automationMode, setAutomationMode, planOf?.automationLimit, d.overrides.automationLimit)}
        </div>
        <fieldset>
          <legend className="text-xs font-medium text-fg-muted">{k.grants}</legend>
          <p className="text-[11px] text-fg-subtle">{k.grantsHint}</p>
          <ul className="mt-2 space-y-1.5">
            {ALL_FEATURES.filter((f) => !planOf?.features.includes(f)).map((feature) => {
              const g = grant.get(feature);
              const label = t.billing.features[feature as keyof typeof t.billing.features] ?? feature;
              return (
                <li key={feature} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex min-w-[12rem] flex-1 items-center gap-2">
                    <input type="checkbox" name={`g:${feature}`} defaultChecked={!!g} />
                    {label}
                    {g && !g.active && <span className="rounded-full bg-muted px-1.5 text-[10px] text-fg-subtle">{k.expired}</span>}
                  </label>
                  <input type="date" name={`u:${feature}`} defaultValue={g?.until?.slice(0, 10) ?? ""} aria-label={`${label}: ${k.until}`} title={k.until} className="input mt-0 h-8 w-40 text-xs" />
                </li>
              );
            })}
          </ul>
        </fieldset>
        <button type="submit" disabled={pending || !hydrated} className="btn-ghost border border-border">
          {k.saveLimits}
        </button>
      </form>
    </div>
  );
}
