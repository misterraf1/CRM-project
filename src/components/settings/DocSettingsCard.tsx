"use client";

import type { DocSettings } from "@/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { useHydrated } from "@/lib/use-hydrated";

/** Seller details and default terms printed on every quote and invoice. */
export function DocSettingsCard({ settings }: { settings: DocSettings }) {
  const { t } = useI18n();
  const k = t.sales.settings;
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(["legalName", "taxId", "address", "bankDetails", "terms"].map((key) => [key, String(f.get(key) ?? "")]));
    startTransition(async () => {
      setError(undefined);
      setSaved(false);
      const res = await api("/settings/documents", "PATCH", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">{k.title}</h2>
      <p className="mt-1 text-xs text-fg-muted">{k.hint}</p>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2" aria-busy={pending}>
        <label className="field-label">
          {k.legalName}
          <input name="legalName" maxLength={200} defaultValue={settings.legalName ?? ""} className="input" />
        </label>
        <label className="field-label">
          {k.taxId}
          <input name="taxId" maxLength={40} defaultValue={settings.taxId ?? ""} className="input" />
        </label>
        <label className="field-label sm:col-span-2">
          {k.address}
          <input name="address" maxLength={300} defaultValue={settings.address ?? ""} className="input" />
        </label>
        <label className="field-label sm:col-span-2">
          {k.bankDetails}
          <textarea name="bankDetails" rows={3} maxLength={1000} defaultValue={settings.bankDetails ?? ""} className="input min-h-[72px] py-2" />
        </label>
        <label className="field-label sm:col-span-2">
          {k.terms}
          <textarea name="terms" rows={3} maxLength={2000} defaultValue={settings.terms ?? ""} className="input min-h-[72px] py-2" />
        </label>
        {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger sm:col-span-2">{error}</p>}
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={pending || !hydrated} className="btn-primary">
            {t.sales.save}
          </button>
          {saved && <span role="status" className="text-sm text-success">{k.saved}</span>}
        </div>
      </form>
    </section>
  );
}
