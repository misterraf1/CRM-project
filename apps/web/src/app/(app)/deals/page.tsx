import { Search } from "lucide-react";
import type { Metadata } from "next";
import { Board } from "@/components/deals/Board";
import { ForecastBar } from "@/components/deals/ForecastBar";
import { getDeals, getForecast, getPipelines } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";
import { planGate } from "@/components/billing/UpgradeGate";

export const metadata: Metadata = { title: "Deals" };

type Props = { searchParams: Promise<{ q?: string }> };

export default async function DealsPage({ searchParams }: Props) {
  const gate = await planGate("deals.pipeline");
  if (gate) return gate;
  const { q } = await searchParams;
  const [{ t, locale }, pipelines] = await Promise.all([getI18n(), getPipelines()]);
  const pipeline = pipelines[0];
  // Every company gets a pipeline at signup; this only guards against broken data
  if (!pipeline) return <p className="card p-6 text-sm text-fg-muted">{t.errors.NOT_FOUND}</p>;
  const [deals, forecast] = await Promise.all([getDeals({ pipelineId: pipeline.id, q }), getForecast(pipeline.id)]);
  const d = t.deals;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{d.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {pipeline.name} · {d.subtitle}
          </p>
        </div>
        <form action="/deals" className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-fg-subtle" aria-hidden />
          <input name="q" defaultValue={q} placeholder={d.search} aria-label={d.search} className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-sm outline-none focus:border-accent" />
        </form>
      </div>
      <ForecastBar f={forecast} t={t} locale={locale} />
      <Board pipeline={pipeline} deals={deals} />
    </div>
  );
}
