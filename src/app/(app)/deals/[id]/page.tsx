import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/crm/DeleteButton";
import { Timeline } from "@/components/crm/Timeline";
import { DealEditor } from "@/components/deals/DealEditor";
import { DealDocs } from "@/components/sales/DealDocs";
import { RecordFiles } from "@/components/crm/RecordFiles";
import { getContacts, getCurrencySettings, getDeal, getDealDocs, getFields, getMembers, getPipelines, getRecordFiles, getSession } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { formatDate, formatMoney } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";
import { planGate } from "@/components/billing/UpgradeGate";

export const metadata: Metadata = { title: "Deals" };

type Props = { params: Promise<{ id: string }> };

export default async function DealPage({ params }: Props) {
  const gate = await planGate("deals.pipeline");
  if (gate) return gate;
  const { id } = await params;
  const deal = await getDeal(id).catch((e) => {
    if (e instanceof ApiRequestError && e.status === 404) notFound();
    throw e;
  });
  const [{ t, locale }, me, pipelines, members, contacts, currencies, fields, docs, files] = await Promise.all([
    getI18n(),
    getSession(),
    getPipelines(),
    getMembers(),
    getContacts({ limit: "100" }),
    getCurrencySettings(),
    getFields("deal"),
    // Members without any document rights simply see none
    getDealDocs(id).catch(() => []),
    getRecordFiles("deals", id),
  ]);
  const pipeline = pipelines.find((p) => p.id === deal.pipelineId)!;
  const stage = pipeline.stages.find((s) => s.id === deal.stageId)!;
  const d = t.deals;

  return (
    <div className="space-y-5">
      <Link href="/deals" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {d.back}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{deal.title}</h1>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-fg-muted">
            <span className="tabular font-semibold text-fg">{formatMoney(deal.amount, locale, deal.currency)}</span>
            <span className={stage.kind === "won" ? "text-success" : stage.kind === "lost" ? "text-danger" : ""}>{stage.name}</span>
            {deal.contact && (
              <Link href={`/crm/${deal.contact.id}`} className="hover:text-accent">
                {deal.contact.name}
              </Link>
            )}
            {deal.closedAt && <span>{interpolate(d.closedAt, { date: formatDate(deal.closedAt, locale, "long") })}</span>}
            {deal.lostReason && (
              <span className="text-danger">{interpolate(d.lostReason, { reason: d.reasons[deal.lostReason as keyof typeof d.reasons] ?? deal.lostReason })}</span>
            )}
          </p>
        </div>
        {me.permissions.includes("deals.delete") && (
          <DeleteButton path={`/deals/${deal.id}`} confirmText={interpolate(d.confirmDelete, { title: deal.title })} label={d.delete} redirectTo="/deals" />
        )}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card min-w-0 p-5">
          <DealEditor
            deal={deal}
            pipeline={pipeline}
            contacts={contacts.items}
            members={members}
            canAssign={me.permissions.includes("contacts.manage")}
            readOnly={!me.permissions.includes("deals.edit")}
            currencies={currencies.available}
            fields={fields}
          />
        </section>
        <div className="min-w-0 space-y-5">
        <RecordFiles path={`/deals/${deal.id}`} files={files} canUpload={me.permissions.includes("deals.edit")} canDeleteAny={me.permissions.includes("contacts.manage")} meId={me.membership.id} />
        <DealDocs docs={docs} dealId={deal.id} canQuote={me.permissions.includes("quotes.manage")} t={t} locale={locale} />
        <section className="card min-w-0">
          <h2 className="px-5 pt-4 text-sm font-semibold">{d.history}</h2>
          <div className="mt-3 border-t border-border">
            <Timeline items={deal.activities} t={t} locale={locale} />
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}
