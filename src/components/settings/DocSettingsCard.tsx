"use client";

import { LOGO_MAX_BYTES, type DocSettings } from "@/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
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
  const [logo, setLogo] = useState(settings.logo);
  useEffect(() => setLogo(settings.logo), [settings.logo]);

  function saveLogo(dataUrl: string | null) {
    startTransition(async () => {
      setError(undefined);
      const res = await api<DocSettings>("/settings/documents/logo", "POST", { dataUrl });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setLogo(res.data.logo);
      router.refresh();
    });
  }

  function pickLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) return setError(k.logoTooBig);
    const reader = new FileReader();
    reader.onload = () => saveLogo(String(reader.result));
    reader.readAsDataURL(file);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const discount = String(f.get("maxDiscount") ?? "").replace(",", ".").trim();
    const body = {
      ...Object.fromEntries(["legalName", "taxId", "address", "bankDetails", "terms"].map((key) => [key, String(f.get(key) ?? "")])),
      maxDiscountBp: discount === "" ? null : Math.round(Number(discount) * 100),
      orderSteps: String(f.get("orderSteps") ?? "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
    };
    if (body.maxDiscountBp !== null && !(body.maxDiscountBp >= 0 && body.maxDiscountBp <= 10_000)) return setError(t.errors.VALIDATION_FAILED);
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
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={k.logo} className="h-12 max-w-[10rem] rounded border border-border object-contain p-1" />
        ) : (
          <span className="grid h-12 w-20 place-items-center rounded border border-dashed border-border text-[11px] text-fg-subtle">{k.logo}</span>
        )}
        <label className="btn-ghost h-8 cursor-pointer border border-border text-xs">
          {k.logoUpload}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} disabled={pending || !hydrated} className="sr-only" />
        </label>
        {logo && (
          <button type="button" disabled={pending} onClick={() => saveLogo(null)} className="text-xs font-medium text-danger hover:underline">
            {k.logoRemove}
          </button>
        )}
        <p className="w-full text-[11px] text-fg-subtle">{k.logoHint}</p>
      </div>
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
        <label className="field-label">
          {k.maxDiscount}
          <input name="maxDiscount" inputMode="decimal" defaultValue={settings.maxDiscountBp === null || settings.maxDiscountBp === undefined ? "" : String(settings.maxDiscountBp / 100)} aria-describedby="max-discount-hint" className="input" />
          <span id="max-discount-hint" className="mt-1 block text-[11px] font-normal text-fg-subtle">
            {k.maxDiscountHint}
          </span>
        </label>
        <label className="field-label">
          {k.orderSteps}
          <textarea name="orderSteps" rows={3} defaultValue={(settings.orderSteps ?? []).join("\n")} aria-describedby="order-steps-hint" className="input min-h-[72px] py-2" />
          <span id="order-steps-hint" className="mt-1 block text-[11px] font-normal text-fg-subtle">
            {k.orderStepsHint}
          </span>
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
