import type { DocKind } from "@/shared";
import { EmptyState } from "@/components/ui/EmptyState";
import clsx from "clsx";
import { FileText, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DocStatusBadge } from "@/components/sales/DocStatusBadge";
import { SalesTabs } from "@/components/sales/SalesTabs";
import { getDocs, getSession } from "@/lib/api";
import { formatDate, formatMoneyExact } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Quotes & invoices" };

const FILTERS: Record<DocKind, string[]> = {
  quote: ["draft", "sent", "accepted", "rejected", "expired"],
  invoice: ["draft", "issued", "overdue", "paid", "void"],
};

type Props = { searchParams: Promise<{ kind?: string; status?: string }> };

export default async function SalesPage({ searchParams }: Props) {
  const [{ t, locale }, me, sp] = await Promise.all([getI18n(), getSession(), searchParams]);
  const k = t.sales;
  const finance = me.permissions.includes("finance.view") || me.permissions.includes("invoices.manage");
  const canQuote = me.permissions.includes("quotes.manage") || me.permissions.includes("finance.view");
  if (!canQuote && !finance) return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;
  const kind: DocKind = sp.kind === "invoice" && finance ? "invoice" : "quote";
  const status = FILTERS[kind].includes(sp.status ?? "") ? sp.status : undefined;
  const docs = await getDocs(kind, { status });
  const canCreate = me.permissions.includes(kind === "quote" ? "quotes.manage" : "invoices.manage");
  const href = (s?: string) => `/sales?kind=${kind}${s ? `&status=${s}` : ""}`;

  return (
    <div>
      <SalesTabs invoices={finance} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{kind === "quote" ? k.quotes : k.invoices}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">{kind === "quote" ? k.quotesSubtitle : k.invoicesSubtitle}</p>
        </div>
        {canCreate && (
          <Link href={`/sales/new?kind=${kind}`} className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            {kind === "quote" ? k.newQuote : k.newInvoice}
          </Link>
        )}
      </div>
      <section className="card">
        <nav aria-label={k.status} className="flex flex-wrap gap-1 border-b border-border p-3">
          {[undefined, ...FILTERS[kind]].map((s) => (
            <Link
              key={s ?? "all"}
              href={href(s)}
              aria-current={status === s ? "true" : undefined}
              className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", status === s ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-muted hover:text-fg")}
            >
              {s ? k.statuses[s as keyof typeof k.statuses] : k.all}
            </Link>
          ))}
        </nav>
        {docs.length === 0 ? (
          <EmptyState icon={FileText} title={kind === "quote" ? k.noQuotes : k.noInvoices} hint={t.empties.sales.hint} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-fg-subtle">
                  <th scope="col" className="px-4 py-2 font-medium">№</th>
                  <th scope="col" className="px-3 py-2 font-medium">{k.customer}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{k.deal}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{k.total}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{k.status}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{kind === "quote" ? k.validUntil : k.dueDate}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{k.owner}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {docs.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/sales/${d.id}`} className="font-mono text-xs font-medium text-accent hover:underline">
                        {d.number ?? k.draftNumber}
                      </Link>
                    </td>
                    <td className="px-3">{d.contact?.name ?? "—"}</td>
                    <td className="max-w-[14rem] truncate px-3 text-fg-muted">{d.deal?.title ?? "—"}</td>
                    <td className="tabular whitespace-nowrap px-3 text-right font-medium">{formatMoneyExact(d.total, locale, d.currency)}</td>
                    <td className="px-3">
                      <DocStatusBadge doc={d} t={t} />
                    </td>
                    <td className="whitespace-nowrap px-3 text-xs text-fg-muted">{d.dueDate ? formatDate(d.dueDate, locale, "short") : "—"}</td>
                    <td className="px-4 text-xs text-fg-muted">{d.owner?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
