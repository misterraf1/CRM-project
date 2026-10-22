import type { ForecastDto } from "@axis/shared";
import { formatMoney } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { interpolate, type Locale } from "@/lib/i18n/locales";

export function ForecastBar({ f, t, locale }: { f: ForecastDto; t: Dictionary; locale: Locale }) {
  const d = t.deals;
  const top = f.lostThisMonth.reasons[0];
  const items = [
    { label: d.open, value: formatMoney(f.open.amount, locale, f.currency), sub: interpolate(d.count, { n: f.open.count }) },
    { label: d.weighted, value: formatMoney(f.weighted, locale, f.currency), sub: d.weightedHint },
    { label: d.wonMonth, value: formatMoney(f.wonThisMonth.amount, locale, f.currency), sub: interpolate(d.count, { n: f.wonThisMonth.count }), tone: "text-success" },
    {
      label: d.lostMonth,
      value: formatMoney(f.lostThisMonth.amount, locale, f.currency),
      sub: top
        ? interpolate(d.topReason, { reason: d.reasons[top.reason as keyof typeof d.reasons] ?? top.reason })
        : interpolate(d.count, { n: f.lostThisMonth.count }),
      tone: "text-danger",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="card min-w-0 p-4">
          <p className="text-xs font-medium text-fg-muted">{i.label}</p>
          <p className={`tabular mt-1.5 truncate text-xl font-semibold tracking-tight ${i.tone ?? ""}`}>{i.value}</p>
          <p className="mt-0.5 truncate text-xs text-fg-subtle" title={i.sub}>
            {i.sub}
          </p>
        </div>
      ))}
    </div>
  );
}
