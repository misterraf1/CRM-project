import type { DocSummaryDto } from "@/shared";
import { Plus } from "lucide-react";
import Link from "next/link";
import { formatMoneyExact } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import type { Locale } from "@/lib/i18n/locales";
import { DocStatusBadge } from "./DocStatusBadge";

/** Quotes and invoices of a deal, with a shortcut to write a quote for it. */
export function DealDocs({ docs, dealId, canQuote, t, locale }: { docs: DocSummaryDto[]; dealId: string; canQuote: boolean; t: Dictionary; locale: Locale }) {
  const k = t.sales;
  return (
    <section className="card min-w-0" aria-labelledby="deal-docs">
      <header className="flex items-center justify-between gap-2 px-5 pt-4">
        <h2 id="deal-docs" className="text-sm font-semibold">
          {k.dealDocs}
        </h2>
        {canQuote && (
          <Link href={`/sales/new?kind=quote&dealId=${dealId}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {k.newQuote}
          </Link>
        )}
      </header>
      {docs.length === 0 ? (
        <p className="px-5 py-4 text-sm text-fg-muted">{k.noDealDocs}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border border-t border-border">
          {docs.map((d) => (
            <li key={d.id}>
              <Link href={`/sales/${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 hover:bg-muted/50">
                <span className="text-xs text-fg-subtle">{d.kind === "quote" ? k.quoteShort : k.invoiceShort}</span>
                <span className="font-mono text-xs font-medium">{d.number ?? k.draftNumber}</span>
                <span className="tabular ml-auto text-sm font-medium">{formatMoneyExact(d.total, locale, d.currency)}</span>
                <DocStatusBadge doc={d} t={t} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
