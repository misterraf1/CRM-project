import type { MoneyMonth } from "@axis/shared";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { formatMoney, formatMonth } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locales";

const HEIGHT = 160;

/**
 * Revenue vs costs per month: grouped bars on one axis (same unit), legend above,
 * hover tooltip per month, and the same figures as a table underneath.
 */
export function RevenueChart({ months, locale, t }: { months: MoneyMonth[]; locale: Locale; t: Dictionary }) {
  const k = t.admin.overview;
  const max = Math.max(1, ...months.flatMap((m) => [m.revenue, m.expenses]));
  const bar = (v: number) => (v ? Math.max(2, Math.round((v / max) * HEIGHT)) : 0);
  const money = (v: number) => formatMoney(v, locale);
  return (
    <figure>
      <div className="flex items-center gap-4 text-xs text-fg-muted" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-series-1" />
          {k.revenue}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-series-2" />
          {k.expenses}
        </span>
      </div>
      <div className="relative mt-3 border-b border-border" style={{ height: HEIGHT }} aria-hidden>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" />
        <span className="absolute -top-2 right-0 bg-surface pl-1 text-[10px] text-fg-subtle">{money(max)}</span>
        <div className="absolute inset-0 grid grid-cols-6 gap-2">
          {months.map((m) => (
            <div key={m.month} className="group relative flex items-end justify-center gap-0.5">
              <span className="w-[38%] max-w-7 rounded-t bg-series-1" style={{ height: bar(m.revenue) }} />
              <span className="w-[38%] max-w-7 rounded-t bg-series-2" style={{ height: bar(m.expenses) }} />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg group-hover:block">
                <p className="font-medium">{formatMonth(m.month, locale)}</p>
                <p className="tabular text-fg-muted">
                  {k.revenue}: <span className="text-fg">{money(m.revenue)}</span>
                </p>
                <p className="tabular text-fg-muted">
                  {k.expenses}: <span className="text-fg">{money(m.expenses)}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 grid grid-cols-6 gap-2 text-center text-[11px] text-fg-subtle" aria-hidden>
        {months.map((m) => (
          <span key={m.month}>{formatMonth(m.month, locale)}</span>
        ))}
      </div>
      <div className="relative mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] text-xs">
          <caption className="sr-only">{k.months}</caption>
          <thead>
            <tr className="border-b border-border text-left text-fg-subtle">
              <th scope="col" className="py-1.5 font-medium">{k.month}</th>
              <th scope="col" className="py-1.5 text-right font-medium">{k.revenue}</th>
              <th scope="col" className="py-1.5 text-right font-medium">{k.expenses}</th>
              <th scope="col" className="py-1.5 text-right font-medium">{k.profit}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {months.map((m) => (
              <tr key={m.month}>
                <td className="py-1.5">{formatMonth(m.month, locale)}</td>
                <td className="tabular py-1.5 text-right">{money(m.revenue)}</td>
                <td className="tabular py-1.5 text-right">{money(m.expenses)}</td>
                <td className={`tabular py-1.5 text-right font-medium ${m.revenue - m.expenses < 0 ? "text-danger" : ""}`}>{money(m.revenue - m.expenses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
