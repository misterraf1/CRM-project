import type { TargetsDto } from "@/shared";
import clsx from "clsx";
import { CardHeader } from "@/components/ui/Card";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { formatMoney } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locales";

/** This month's targets that are set: the company's and the viewer's own. */
export function TargetCard({ data, meId, t, locale }: { data: TargetsDto; meId: string; t: Dictionary; locale: Locale }) {
  const rows = data.rows.filter((r) => r.amount > 0 && (!r.member || r.member.id === meId));
  if (!rows.length) return null;
  return (
    <section className="card pb-4">
      <CardHeader title={t.targets.dashboard} action={{ href: "/targets", label: t.targets.title }} />
      <ul className="mt-3 space-y-3 px-5">
        {rows.map((r) => (
          <li key={r.member?.id ?? "company"}>
            <div className="flex justify-between gap-2 text-sm">
              <span className="truncate text-fg-muted">{r.member?.name ?? t.targets.company}</span>
              <span className="tabular shrink-0">
                <span className="font-semibold">{r.percent}%</span>
                <span className="text-xs text-fg-subtle"> · {formatMoney(r.achieved, locale, data.currency)} / {formatMoney(r.amount, locale, data.currency)}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={clsx("h-full rounded-full", r.percent >= 100 ? "bg-success" : "bg-accent")} style={{ width: `${Math.min(100, r.percent)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
