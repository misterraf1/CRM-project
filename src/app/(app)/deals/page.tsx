import clsx from "clsx";
import { Search, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ExportMenu } from "@/components/crm/ExportMenu";
import { Board } from "@/components/deals/Board";
import { ForecastBar } from "@/components/deals/ForecastBar";
import { getDeals, getFields, getForecast, getPipelines, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";
import { planGate } from "@/components/billing/UpgradeGate";

export const metadata: Metadata = { title: "Deals" };

type Props = { searchParams: Promise<{ q?: string; pipeline?: string; new?: string }> };

export default async function DealsPage({ searchParams }: Props) {
  const gate = await planGate("deals.pipeline");
  if (gate) return gate;
  const { q, pipeline: pipelineId, new: startNew } = await searchParams;
  const [{ t, locale }, pipelines, me, dealFields] = await Promise.all([getI18n(), getPipelines(), getSession(), getFields("deal")]);
  // Default pipeline first (API order); ?pipeline= picks another
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  // Every company gets a pipeline at signup; this only guards against broken data
  if (!pipeline) return <p className="card p-6 text-sm text-fg-muted">{t.errors.NOT_FOUND}</p>;
  const [deals, forecast] = await Promise.all([getDeals({ pipelineId: pipeline.id, q }), getForecast(pipeline.id)]);
  const d = t.deals;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{d.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {pipeline.name} · {d.subtitle}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {me.permissions.includes("deals.export") && <ExportMenu href={`/api/v1/exports/deals?pipelineId=${pipeline.id}&lang=${locale}`} label={t.imports.export} />}
          {me.permissions.includes("data.import") && (
            <Link href="/crm/import?entity=deal" className="btn-ghost border border-border">
              <Upload className="h-4 w-4" aria-hidden />
              {t.imports.open}
            </Link>
          )}
          <form action="/deals" className="relative w-full sm:w-72">
            {pipeline.id !== pipelines[0]?.id && <input type="hidden" name="pipeline" value={pipeline.id} />}
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-fg-subtle" aria-hidden />
            <input name="q" defaultValue={q} placeholder={d.search} aria-label={d.search} className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-sm outline-none focus:border-accent" />
          </form>
        </div>
      </div>
      {pipelines.length > 1 && (
        <nav aria-label={d.pipeline} className="flex flex-wrap gap-1 rounded-lg bg-muted p-0.5 sm:w-fit">
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={p.id === pipelines[0]!.id ? "/deals" : `/deals?pipeline=${p.id}`}
              aria-current={p.id === pipeline.id ? "page" : undefined}
              className={clsx("rounded-md px-3 py-1.5 text-xs font-medium", p.id === pipeline.id ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
            >
              {p.name}
            </Link>
          ))}
        </nav>
      )}
      <ForecastBar f={forecast} t={t} locale={locale} />
      <Board
        key={pipeline.id}
        pipeline={pipeline}
        deals={deals}
        currency={me.tenant.currency}
        requiredFields={dealFields.filter((f) => f.required)}
        canCreate={me.permissions.includes("deals.create")}
        canMove={me.permissions.includes("deals.edit")}
        startCreating={startNew === "1"}
      />
    </div>
  );
}
