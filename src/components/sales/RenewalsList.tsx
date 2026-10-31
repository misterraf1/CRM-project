"use client";

import type { RenewalDto, RenewalStatus } from "@/shared";
import clsx from "clsx";
import Link from "next/link";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { formatDate, formatMoneyExact } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

/** Renewals of recurring services; marking one renewed or lost takes it off the list. */
export function RenewalsList({ renewals: initial, status }: { renewals: RenewalDto[]; status: RenewalStatus }) {
  const { t, locale } = useI18n();
  const k = t.renewals;
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const mark = (r: RenewalDto, next: RenewalStatus) =>
    startTransition(async () => {
      setError(undefined);
      const res = await api(`/renewals/${r.id}`, "PATCH", { status: next });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setRows((all) => all.filter((x) => x.id !== r.id));
    });

  return (
    <section className="card" aria-busy={pending}>
      <nav aria-label={k.title} className="flex flex-wrap gap-1 border-b border-border p-3">
        {(["upcoming", "renewed", "lost"] as const).map((s) => (
          <Link
            key={s}
            href={s === "upcoming" ? "/sales/renewals" : `/sales/renewals?status=${s}`}
            aria-current={status === s ? "true" : undefined}
            className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", status === s ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-muted hover:text-fg")}
          >
            {k.filters[s]}
          </Link>
        ))}
      </nav>
      {error && <p role="alert" className="m-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-fg-muted">{k.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.productName}</span>
                <Link href={`/crm/${r.contact.id}`} className="block truncate text-xs text-fg-muted hover:text-accent">
                  {r.contact.name}
                  {r.owner && ` · ${r.owner.name}`}
                </Link>
              </span>
              <span className="tabular text-xs text-fg-muted">{formatMoneyExact(r.amount, locale, r.currency)}</span>
              <span className={clsx("text-xs", r.overdue ? "font-medium text-danger" : "text-fg-muted")}>
                {r.overdue && `${k.overdue} · `}
                {formatDate(r.dueAt, locale, "long")}
              </span>
              {status === "upcoming" && (
                <span className="flex gap-1">
                  <button type="button" disabled={pending} onClick={() => mark(r, "renewed")} className="btn-ghost h-8 border border-border text-xs text-success">
                    {k.renewed}
                  </button>
                  <button type="button" disabled={pending} onClick={() => mark(r, "lost")} className="btn-ghost h-8 border border-border text-xs">
                    {k.lost}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
