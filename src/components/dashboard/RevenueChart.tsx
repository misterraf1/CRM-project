"use client";

import Link from "next/link";
import { useState } from "react";
import type { DashboardCrmDto } from "@/shared";
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
  const indexAt = (e: React.PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.min(points.length - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * points.length)));
  };

  // Nothing closed yet: a hint instead of an empty grid
  if (points.every((p) => p.amount === 0)) {
    return (
      <div className="px-5 pb-6 pt-4">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <svg aria-hidden viewBox="0 0 120 40" className="h-10 w-28 text-accent/40">
            <path d="M2 36 C20 34 28 26 44 28 S70 14 84 18 108 6 118 4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 6" />
          </svg>
          <p className="text-sm text-fg-muted">{t.dashboard.revenue.empty}</p>
          <Link href="/deals" className="btn-ghost h-9 border border-border">
            {t.dashboard.revenue.emptyAction}
          </Link>
        </div>
      </div>
    );
  }

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
          {/* One focusable chart instead of a button per bar (bars are a few px wide):
              arrow keys / pointer pick a day, the live line above reads it out */}
          <div
            className="relative flex touch-none items-end gap-[3px] rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            style={{ height: HEIGHT }}
            role="group"
            tabIndex={0}
            aria-label={`${t.dashboard.revenue.title}. ${t.dashboard.revenue.keyboardHint}`}
            onPointerMove={(e) => setActive(indexAt(e))}
            onPointerDown={(e) => setActive(indexAt(e))}
            onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
            onFocus={() => setActive((a) => a ?? points.length - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              const last = points.length - 1;
              const next =
                e.key === "ArrowLeft" ? Math.max(0, (active ?? last) - 1)
                : e.key === "ArrowRight" ? Math.min(last, (active ?? last) + 1)
                : e.key === "Home" ? 0
                : e.key === "End" ? last
                : null;
              if (next === null) return;
              e.preventDefault();
              setActive(next);
            }}
          >
            {points.map((p, i) => (
              <span key={p.date} aria-hidden className="flex h-full min-w-0 flex-1 items-end">
                <span
                  className={`block w-full rounded-t-[3px] transition-colors ${active === i ? "bg-accent" : "bg-accent/35"}`}
                  style={{ height: `${Math.max(p.amount > 0 ? 2 : 0, (p.amount / max) * 100)}%` }}
                />
              </span>
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
