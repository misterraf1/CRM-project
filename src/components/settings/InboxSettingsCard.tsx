"use client";

import type { InboxSettings } from "@/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { useHydrated } from "@/lib/use-hydrated";

/** Business hours (the company's time zone), the away message and the first-response target. */
export function InboxSettingsCard({ settings, canManage }: { settings: InboxSettings; canManage: boolean }) {
  const { t } = useI18n();
  const k = t.channels.hours;
  const router = useRouter();
  const hydrated = useHydrated();
  const [hours, setHours] = useState(settings.hours);
  const [autoReply, setAutoReply] = useState(settings.autoReply);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: InboxSettings = {
      hours,
      autoReply,
      awayMessage: String(f.get("awayMessage") ?? "").trim() || null,
      slaMinutes: Number(f.get("slaMinutes")),
    };
    startTransition(async () => {
      setError(undefined);
      setSaved(false);
      const res = await api<InboxSettings>("/inbox/settings", "PATCH", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setSaved(true);
      router.refresh();
    });
  }

  const day = (i: number, patch: Partial<InboxSettings["hours"][number]>) => setHours((all) => all.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <section className="card p-5" aria-labelledby="hours-title">
      <h2 id="hours-title" className="text-sm font-semibold">
        {k.title}
      </h2>
      <p className="mt-1 text-xs text-fg-muted">{k.hint}</p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <fieldset disabled={!canManage || pending} className="space-y-4">
          <table className="w-full text-sm">
            <caption className="sr-only">{k.title}</caption>
            <tbody className="divide-y divide-border">
              {hours.map((d, i) => (
                <tr key={i}>
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={d.open} onChange={(e) => day(i, { open: e.target.checked })} />
                      {k.days[i]}
                    </label>
                  </th>
                  <td className="py-1.5">
                    {d.open ? (
                      <span className="flex items-center gap-1">
                        <input type="time" value={d.start} onChange={(e) => day(i, { start: e.target.value })} aria-label={`${k.days[i]}: ${k.from}`} className="input mt-0 h-8 w-28" />
                        <span aria-hidden>–</span>
                        <input type="time" value={d.end} onChange={(e) => day(i, { end: e.target.value })} aria-label={`${k.days[i]}: ${k.to}`} className="input mt-0 h-8 w-28" />
                      </span>
                    ) : (
                      <span className="text-xs text-fg-subtle">{k.closed}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoReply} onChange={(e) => setAutoReply(e.target.checked)} />
            {k.autoReply}
          </label>
          <label className="field-label">
            {k.awayMessage}
            <textarea name="awayMessage" rows={2} maxLength={1000} required={autoReply} defaultValue={settings.awayMessage ?? ""} placeholder={k.awayPlaceholder} className="input min-h-[60px] py-2" />
          </label>
          <label className="field-label">
            {k.sla}
            <input name="slaMinutes" type="number" min={5} max={10080} required defaultValue={settings.slaMinutes} aria-describedby="sla-hint" className="input w-32" />
            <span id="sla-hint" className="mt-1 block text-[11px] font-normal text-fg-subtle">
              {k.slaHint}
            </span>
          </label>
          {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          {canManage && (
            <div className="flex items-center gap-3">
              <button type="submit" disabled={pending || !hydrated} className="btn-primary">
                {t.sales.save}
              </button>
              {saved && <span role="status" className="text-sm text-success">{k.saved}</span>}
            </div>
          )}
        </fieldset>
      </form>
    </section>
  );
}
