import clsx from "clsx";
import Link from "next/link";
import { PERIODS, type Period } from "@/lib/api/types";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";

export function PeriodFilter({ value, t }: { value: Period; t: Dictionary }) {
  return (
    <nav aria-label={t.dashboard.periodLabel} className="flex rounded-lg border border-border bg-surface p-0.5">
      {PERIODS.map((p) => (
        <Link
          key={p}
          href={`?period=${p}`}
          scroll={false}
          aria-current={p === value ? "true" : undefined}
          className={clsx(
            "rounded-md px-3 py-1.5 text-xs font-medium",
            p === value ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-muted hover:text-fg",
          )}
        >
          {t.dashboard.period[p]}
        </Link>
      ))}
    </nav>
  );
}
