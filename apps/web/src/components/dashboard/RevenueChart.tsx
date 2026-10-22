"use client";

import { useState } from "react";
import type { DashboardCrmDto } from "@axis/shared";
import { formatDate, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { interpolate } from "@/lib/i18n/locales";

const HEIGHT = 200;

/** Rounds the max up to a "nice" number so gridlines land on readable values. */
function niceMax(value: number) {
  if (value <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function RevenueChart({ revenue, currency }: { revenue: DashboardCrmDto["revenue"]; currency: string }) {
  const { t, locale } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  const { points, bucket } = revenue;
  const max = niceMax(Math.max(...points.map((p) => p.amount)));
  const ticks = [0, 0.5, 1].map((f) => f * max);
  // Label density: ~7 labels regardless of bucket count
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const current = active !== null ? points[active] : null;

  return (
    <div className="px-5 pb-4 pt-3">
      <div className="mb-2 h-10 text-sm" aria-live="polite">
        {current ? (
          <>
            <p className="tabular font-semibold">{formatMoney(current.amount, locale, currency)}</p>
            <p className="text-xs text-fg-subtle">
              {formatDate(current.date, locale, "long")} ·{" "}
              {interpolate(t.dashboard.revenue.deals, { n: current.deals })}
            </p>
          </>
        ) : null}
      </div>
      <div className="flex gap-3">
        <div className="tabular flex flex-col justify-between text-right text-[11px] text-fg-subtle" style={{ height: HEIGHT }}>
          {[...ticks].reverse().map((v) => (
            <span key={v} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {formatMoney(v, locale, currency, true)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: HEIGHT }}>
            {ticks.map((v) => (
              <div key={v} className="border-t border-dashed border-border" />
            ))}
          </div>
          <div
            className="relative flex items-end gap-[3px]"
            style={{ height: HEIGHT }}
            onMouseLeave={() => setActive(null)}
            role="list"
            aria-label={t.dashboard.revenue.title}
          >
            {points.map((p, i) => (
              <button
                key={p.date}
                type="button"
                role="listitem"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${formatDate(p.date, locale)}: ${formatMoney(p.amount, locale, currency)}`}
                className="group flex h-full min-w-0 flex-1 items-end"
              >
                <span
                  className={`block w-full rounded-t-[3px] transition-colors ${
                    active === i ? "bg-accent" : "bg-accent/35 group-hover:bg-accent/60"
                  }`}
                  style={{ height: `${Math.max(p.amount > 0 ? 2 : 0, (p.amount / max) * 100)}%` }}
                />
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-[3px] text-[11px] text-fg-subtle">
            {points.map((p, i) => (
              <span key={p.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
                {i % labelEvery === 0 ? formatDate(p.date, locale, bucket === "week" ? "short" : "day") : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
