import type { DashboardCrmDto } from "@/shared";
import Link from "next/link";
import { CardHeader } from "@/components/ui/Card";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { formatMoney } from "@/lib/format";
import { interpolate, type Locale } from "@/lib/i18n/locales";

/** Where the open deals stand: one bar per stage, each opening the board. */
export function PipelineSnapshot({ pipeline, currency, t, locale }: { pipeline: NonNullable<DashboardCrmDto["pipeline"]>; currency: string; t: Dictionary; locale: Locale }) {
  const k = t.dashboard.pipeline;
  const max = Math.max(1, ...pipeline.stages.map((s) => s.amount));
  const total = pipeline.stages.reduce((a, s) => a + s.count, 0);
  return (
    <section className="card pb-4">
      <CardHeader title={k.title} meta={`${pipeline.name} · ${k.subtitle}`} action={{ href: `/deals?pipeline=${pipeline.id}`, label: k.open }} />
      {total === 0 ? (
        <p className="px-5 pt-4 text-sm text-fg-muted">{k.empty}</p>
      ) : (
        <ul className="mt-4 space-y-2.5 px-5">
          {pipeline.stages.map((s, i) => (
            <li key={s.id}>
              <Link href={`/deals?pipeline=${pipeline.id}`} className="group grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 rounded-lg py-0.5 text-sm sm:grid-cols-[9rem_1fr_auto]">
                <span className="truncate text-fg-muted group-hover:text-fg">{s.name}</span>
                <span aria-hidden className="relative h-3 overflow-hidden rounded-full bg-muted">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent/60 to-accent transition-all duration-500 group-hover:to-brand-violet"
                    style={{ width: `${Math.max(s.count ? 4 : 0, (s.amount / max) * 100)}%`, opacity: 0.55 + (i / Math.max(1, pipeline.stages.length - 1)) * 0.45 }}
                  />
                </span>
                <span className="tabular whitespace-nowrap text-right text-xs">
                  <span className="text-sm font-semibold">{formatMoney(s.amount, locale, currency, true)}</span>
                  <span className="ml-1.5 text-fg-subtle">{interpolate(k.deals, { n: s.count })}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
