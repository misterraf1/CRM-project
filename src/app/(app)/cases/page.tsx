import type { CaseStatus } from "@/shared";
import clsx from "clsx";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CaseStatusBadge } from "@/components/cases/CaseBadges";
import { PriorityDot } from "@/components/tasks/meta";
import { getCases, getSession } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Cases" };

const FILTERS = ["active", "overdue", "mine", "resolved", "closed", "all"] as const;
type Filter = (typeof FILTERS)[number];

type Props = { searchParams: Promise<{ f?: string }> };

export default async function CasesPage({ searchParams }: Props) {
  const [{ t, locale }, me, sp] = await Promise.all([getI18n(), getSession(), searchParams]);
  const k = t.cases;
  if (!me.permissions.includes("cases.manage")) return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;
  const f: Filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as Filter) : "active";
  const cases = await getCases(f === "mine" ? { status: "active", mine: "true" } : f === "all" ? {} : { status: f });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
        </div>
        <Link href="/cases/new" className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden />
          {k.new}
        </Link>
      </div>
      <section className="card">
        <nav aria-label={k.title} className="flex flex-wrap gap-1 border-b border-border p-3">
          {FILTERS.map((x) => (
            <Link
              key={x}
              href={x === "active" ? "/cases" : `/cases?f=${x}`}
              aria-current={f === x ? "true" : undefined}
              className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", f === x ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-muted hover:text-fg")}
            >
              {k.filters[x]}
            </Link>
          ))}
        </nav>
        {cases.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-fg-muted">{k.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {cases.map((c) => (
              <li key={c.id}>
                <Link href={`/cases/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-muted sm:flex-nowrap">
                  <PriorityDot priority={c.priority} label={t.dashboard.tasks.priority[c.priority]} />
                  <span className="tabular w-24 shrink-0 text-xs text-fg-subtle">{c.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.subject}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {c.contact.name} · {k.types[c.type]}
                      {c.assignee && ` · ${c.assignee.name}`}
                    </span>
                  </span>
                  <span className={clsx("shrink-0 text-xs", c.overdue ? "font-medium text-danger" : "text-fg-subtle")}>
                    {c.overdue ? `${k.overdue} · ` : ""}
                    {formatDateTime(c.dueAt, locale)}
                  </span>
                  <CaseStatusBadge status={c.status as CaseStatus} label={k.statuses[c.status]} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
