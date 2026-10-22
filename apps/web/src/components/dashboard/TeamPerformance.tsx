"use client";

import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { CardHeader } from "@/components/ui/Card";
import type { MemberPerformance } from "@/lib/api/types";
import { formatDuration, formatMoney, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { interpolate } from "@/lib/i18n/locales";

type SortKey = "dealsWon" | "revenue" | "tasksDone" | "tasksOverdue" | "avgResponseMin";

export function TeamPerformance({ rows }: { rows: MemberPerformance[] }) {
  const { t, locale } = useI18n();
  const d = t.dashboard.team;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "revenue", desc: true });

  const columns: { key: SortKey; label: string }[] = [
    { key: "dealsWon", label: d.dealsWon },
    { key: "revenue", label: d.revenue },
    { key: "tasksDone", label: d.tasksDone },
    { key: "tasksOverdue", label: d.overdue },
    { key: "avgResponseMin", label: d.response },
  ];

  const sorted = useMemo(() => {
    const dir = sort.desc ? -1 : 1;
    // Members without a value (no inbox work) always go last
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }, [rows, sort]);

  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <section className="card">
      <CardHeader title={d.title} action={{ href: "/team", label: t.common.viewAll }} />
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-y border-border text-xs text-fg-subtle">
              <th scope="col" className="px-5 py-2 text-left font-medium">
                {d.member}
              </th>
              {columns.map((col) => {
                const active = sort.key === col.key;
                const Arrow = sort.desc ? ArrowDown : ArrowUp;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
                    className="px-3 py-2 text-right font-medium last:pr-5"
                  >
                    <button
                      type="button"
                      onClick={() => setSort((s) => ({ key: col.key, desc: s.key === col.key ? !s.desc : true }))}
                      className={clsx("inline-flex items-center gap-1 hover:text-fg", active && "text-fg")}
                      title={interpolate(d.sortBy, { column: col.label })}
                    >
                      {col.label}
                      {active && <Arrow className="h-3 w-3" aria-hidden />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((row) => (
              <tr key={row.member.id} className="hover:bg-muted/50">
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={row.member.name} />
                    <div className="min-w-0 leading-tight">
                      <p className="truncate font-medium">{row.member.name}</p>
                      <p className="truncate text-xs text-fg-subtle">{row.member.title}</p>
                    </div>
                  </div>
                </td>
                <td className="tabular px-3 text-right">{formatNumber(row.dealsWon, locale)}</td>
                <td className="tabular px-3 text-right">
                  <div className="font-medium">{formatMoney(row.revenue, locale)}</div>
                  <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(row.revenue / maxRevenue) * 100}%` }} />
                  </div>
                </td>
                <td className="tabular px-3 text-right">{formatNumber(row.tasksDone, locale)}</td>
                <td className={clsx("tabular px-3 text-right", row.tasksOverdue > 0 ? "font-medium text-danger" : "text-fg-subtle")}>
                  {row.tasksOverdue}
                </td>
                <td className="tabular px-3 pr-5 text-right text-fg-muted">
                  {row.avgResponseMin === null ? "—" : formatDuration(row.avgResponseMin, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
