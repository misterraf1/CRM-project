"use client";

import type { TargetProgressDto, TargetsDto } from "@/shared";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { formatMoney, moneyInputValue, parseMoneyInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

const shiftStart = (start: string, months: number) => {
  const d = new Date(`${start}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 7);
};

/** Company and member targets with progress; target managers set them inline. */
export function TargetsBoard({ data, label }: { data: TargetsDto; label: string }) {
  const { t, locale } = useI18n();
  const k = t.targets;
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const step = data.period === "quarter" ? 3 : 1;
  const href = (period: string, start: string) => `/targets?period=${period}&start=${start}`;

  const save = (row: TargetProgressDto, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const amount = parseMoneyInput(String(new FormData(e.currentTarget).get("amount") ?? ""));
    if (!amount) return setError(errorMessage(t, "VALIDATION_FAILED"));
    startTransition(async () => {
      setError(undefined);
      const res = await api("/targets", "POST", { memberId: row.member?.id ?? null, period: data.period, start: data.start, amount });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setEditing(null);
      router.refresh();
    });
  };

  const remove = (row: TargetProgressDto) =>
    startTransition(async () => {
      const res = await api(`/targets/${row.id}`, "DELETE");
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      router.refresh();
    });

  return (
    <div className="space-y-4" aria-busy={pending}>
      <div className="card flex flex-wrap items-center gap-2 p-2">
        <div className="flex">
          <Link href={href(data.period, shiftStart(data.start, -step))} aria-label={k.prev} className="grid h-9 w-9 place-items-center rounded-lg text-fg-muted hover:bg-muted hover:text-fg">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link href={href(data.period, shiftStart(data.start, step))} aria-label={k.next} className="grid h-9 w-9 place-items-center rounded-lg text-fg-muted hover:bg-muted hover:text-fg">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <h2 className="flex-1 text-base font-semibold capitalize">{label}</h2>
        <nav aria-label={k.title} className="flex rounded-lg bg-muted p-0.5">
          {(["month", "quarter"] as const).map((p) => (
            <Link
              key={p}
              href={`/targets?period=${p}`}
              aria-current={data.period === p ? "page" : undefined}
              className={clsx("rounded-md px-3 py-1.5 text-xs font-medium", data.period === p ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
            >
              {k.periods[p]}
            </Link>
          ))}
        </nav>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <ul className="space-y-3">
        {data.rows.map((row) => {
          const key = row.member?.id ?? "company";
          const pct = Math.min(100, row.percent);
          return (
            <li key={key} className={clsx("card p-4", !row.member && "border-accent/40")}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="min-w-0 flex-1 font-medium">{row.member?.name ?? k.company}</p>
                <p className="tabular text-sm">
                  <span className="font-semibold">{formatMoney(row.achieved, locale, data.currency)}</span>
                  <span className="text-fg-muted"> / {row.amount ? formatMoney(row.amount, locale, data.currency) : k.noTarget}</span>
                </p>
                <span className="text-xs text-fg-subtle">{interpolate(k.deals, { n: row.wonDeals })}</span>
                {data.canManage && editing !== key && (
                  <span className="flex gap-1">
                    <button type="button" onClick={() => setEditing(key)} aria-label={`${k.set}: ${row.member?.name ?? k.company}`} className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-muted">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {row.id && (
                      <button type="button" disabled={pending} onClick={() => remove(row)} aria-label={`${k.remove}: ${row.member?.name ?? k.company}`} className="grid h-8 w-8 place-items-center rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                )}
              </div>
              {row.amount > 0 && (
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={row.percent} aria-valuemin={0} aria-valuemax={100} aria-label={row.member?.name ?? k.company}>
                    <div className={clsx("h-full rounded-full", row.percent >= 100 ? "bg-success" : row.percent >= 50 ? "bg-accent" : "bg-warning")} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="tabular w-12 text-right text-sm font-semibold">{row.percent}%</span>
                </div>
              )}
              {editing === key && (
                <form onSubmit={(e) => save(row, e)} className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="field-label">
                    {k.amountLabel}, {data.currency}
                    <input name="amount" inputMode="decimal" required autoFocus defaultValue={row.amount ? moneyInputValue(row.amount) : ""} className="input w-40" />
                  </label>
                  <button type="submit" disabled={pending} className="btn-primary">
                    {k.save}
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className="btn-ghost">
                    {t.calendar.cancel}
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
