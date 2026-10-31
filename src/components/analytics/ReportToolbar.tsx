"use client";

import type { SavedReportDto } from "@/shared";
import { Bookmark, Printer, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

/** Any from–to range, saved views (per member), and printing the page as PDF. */
export function ReportToolbar({ from, to, query, saved: initial }: { from?: string; to?: string; query: string; saved: SavedReportDto[] }) {
  const { t } = useI18n();
  const k = t.reports;
  const [saved, setSaved] = useState(initial);
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    startTransition(async () => {
      setError(undefined);
      const res = await api<SavedReportDto[]>("/analytics/saved", "POST", { name, query });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setSaved(res.data);
      setNaming(false);
    });
  }

  const remove = (r: SavedReportDto) =>
    startTransition(async () => {
      const res = await api<SavedReportDto[]>(`/analytics/saved/${r.id}`, "DELETE");
      if (res.ok) setSaved(res.data);
    });

  return (
    <div className="card space-y-3 p-3 print:hidden" aria-busy={pending}>
      <div className="flex flex-wrap items-end gap-2">
        <form action="/analytics" className="flex flex-wrap items-end gap-2">
          <label className="field-label">
            {k.from}
            <input type="date" name="from" defaultValue={from} required className="input h-9 w-auto" />
          </label>
          <label className="field-label">
            {k.to}
            <input type="date" name="to" defaultValue={to} required className="input h-9 w-auto" />
          </label>
          <button type="submit" className="btn-ghost h-9 border border-border">
            {k.apply}
          </button>
        </form>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => setNaming((v) => !v)} aria-expanded={naming} className="btn-ghost h-9 border border-border">
            <Bookmark className="h-4 w-4" aria-hidden />
            {k.save}
          </button>
          <button type="button" onClick={() => window.print()} className="btn-ghost h-9 border border-border">
            <Printer className="h-4 w-4" aria-hidden />
            {k.print}
          </button>
        </div>
      </div>
      {naming && (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <label className="field-label">
            {k.name}
            <input name="name" required minLength={2} maxLength={80} autoFocus className="input h-9" />
          </label>
          <button type="submit" disabled={pending} className="btn-primary h-9">
            {k.saveConfirm}
          </button>
        </form>
      )}
      {saved.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={k.saved}>
          {saved.map((r) => (
            <li key={r.id} className="inline-flex items-center rounded-full border border-border text-xs">
              <Link href={`/analytics?${r.query}`} className="px-2.5 py-1 hover:text-accent">
                {r.name}
              </Link>
              <button type="button" onClick={() => remove(r)} aria-label={`${k.remove}: ${r.name}`} className="grid h-6 w-6 place-items-center rounded-full text-fg-subtle hover:text-danger">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
