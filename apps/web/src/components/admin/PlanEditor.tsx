"use client";

import { ALL_FEATURES, type AdminPlanDto, type PlanUpdateInput } from "@axis/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { adminApi } from "@/lib/api/client";
import { moneyInputValue, parseMoneyInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

const MONEY = ["priceMonthly", "priceYearly", "extraSeatPrice", "extraStorageGbPrice"] as const;

/** One plan's prices, limits and features. Only changed fields are sent. */
export function PlanEditor({ plan, canEdit }: { plan: AdminPlanDto; canEdit: boolean }) {
  const { t } = useI18n();
  const k = t.admin.plans;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const next: PlanUpdateInput = {
      name: String(f.get("name")).trim(),
      seatLimit: Number(f.get("seatLimit")),
      storageMb: Math.round(Number(f.get("storageGb")) * 1024),
      features: ALL_FEATURES.filter((feature) => f.get(`f:${feature}`) === "on"),
      isPublic: f.get("isPublic") === "on",
    };
    for (const key of MONEY) {
      const v = parseMoneyInput(String(f.get(key)));
      if (v === null) return setError(t.errors.VALIDATION_FAILED);
      next[key] = v;
    }
    const changed = Object.fromEntries(
      Object.entries(next).filter(([key, v]) => JSON.stringify(v) !== JSON.stringify(plan[key as keyof AdminPlanDto])),
    ) as PlanUpdateInput;
    if (!Object.keys(changed).length) return setSaved(true);
    startTransition(async () => {
      setError(undefined);
      setSaved(false);
      const res = await adminApi(`/plans/${plan.code}`, "PATCH", changed);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setSaved(true);
      router.refresh();
    });
  }

  const num = (name: string, label: string, value: string | number, step = "1") => (
    <label className="field-label">
      {label}
      <input name={name} defaultValue={value} inputMode="decimal" step={step} required className="input" />
    </label>
  );

  return (
    <form onSubmit={save} className="card p-5" aria-label={plan.name}>
      <fieldset disabled={!canEdit || pending} className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <label className="field-label flex-1">
            <span className="font-mono text-xs text-fg-subtle">{plan.code}</span>
            <input name="name" defaultValue={plan.name} required minLength={2} maxLength={40} className="input text-base font-semibold" />
          </label>
          <span className="text-xs text-fg-subtle">{interpolate(k.tenantsOn, { n: plan.tenants })}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {num("priceMonthly", k.monthly, moneyInputValue(plan.priceMonthly))}
          {num("priceYearly", k.yearly, moneyInputValue(plan.priceYearly))}
          {num("seatLimit", k.seatLimit, plan.seatLimit)}
          {num("storageGb", k.storageGb, plan.storageMb / 1024)}
          {num("extraSeatPrice", k.extraSeat, moneyInputValue(plan.extraSeatPrice))}
          {num("extraStorageGbPrice", k.extraStorage, moneyInputValue(plan.extraStorageGbPrice))}
        </div>
        <fieldset>
          <legend className="text-xs font-medium text-fg-muted">{k.features}</legend>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {ALL_FEATURES.map((feature) => (
              <label key={feature} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`f:${feature}`} defaultChecked={plan.features.includes(feature)} />
                {t.billing.features[feature as keyof typeof t.billing.features] ?? feature}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isPublic" defaultChecked={plan.isPublic} />
          {k.public}
        </label>
        {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        {saved && <p role="status" className="text-xs text-success">{k.saved}</p>}
        {canEdit && (
          <button type="submit" className="btn-primary">
            {k.save}
          </button>
        )}
      </fieldset>
    </form>
  );
}
