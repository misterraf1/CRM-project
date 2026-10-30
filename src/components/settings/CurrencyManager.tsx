"use client";

import { CURRENCIES, type CurrencySettingsDto } from "@/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/** Exchange rates into the company currency; an empty rate means deals can't use that currency. */
export function CurrencyManager({ settings }: { settings: CurrencySettingsDto }) {
  const { t } = useI18n();
  const k = t.crmSettings;
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [invalid, setInvalid] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const others = CURRENCIES.filter((c) => c !== settings.base);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const rates: Record<string, number> = {};
    const bad: string[] = [];
    for (const c of others) {
      const raw = String(f.get(c) ?? "").trim().replace(",", ".");
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) bad.push(c);
      else rates[c] = n;
    }
    setInvalid(bad);
    setSaved(false);
    if (bad.length) return setError(t.errors.VALIDATION_FAILED);
    setError(undefined);
    startTransition(async () => {
      const res = await api("/settings/currencies", "PATCH", { rates });
      if (!res.ok) {
        const used = (res.details as { currencies?: string[] } | undefined)?.currencies;
        return setError(res.code === "CONFLICT" && used ? interpolate(k.currencies.inUse, { list: used.join(", ") }) : errorMessage(t, res.code));
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">{k.currencies.title}</h2>
      <p className="mt-1 text-xs text-fg-muted">{interpolate(k.currencies.hint, { base: settings.base })}</p>
      <form onSubmit={submit} className="mt-4 space-y-3" aria-busy={pending}>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {others.map((c) => (
            <label key={c} className="field-label">
              {interpolate(k.currencies.rate, { currency: c, base: settings.base })}
              <input
                name={c}
                inputMode="decimal"
                defaultValue={settings.rates[c] ?? ""}
                placeholder={k.currencies.none}
                {...(invalid.includes(c) ? { "aria-invalid": true, className: "input border-danger" } : { className: "input" })}
              />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending} className="btn-primary">
            {k.save}
          </button>
          {saved && (
            <span role="status" className="text-sm text-success">
              {k.saved}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
