import type { ProductSalesDto, ReceivablesDto } from "@/shared";
import clsx from "clsx";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { interpolate, type Locale } from "@/lib/i18n/locales";

/** Who owes what (with ageing) and what sells, beside the sales analytics. */
export function MoneyReports({ receivables: r, products: p, t, locale }: { receivables: ReceivablesDto; products: ProductSalesDto; t: Dictionary; locale: Locale }) {
  const k = t.reports;
  const money = (v: number) => formatMoney(v, locale, r.currency);
  const buckets = [
    ["current", k.buckets.current],
    ["d1_30", k.buckets.d1_30],
    ["d31_60", k.buckets.d31_60],
    ["d61_90", k.buckets.d61_90],
    ["d90", k.buckets.d90],
  ] as const;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
      <section className="card" aria-labelledby="receivables">
        <header className="flex items-baseline justify-between gap-3 px-5 pt-4">
          <h2 id="receivables" className="text-sm font-semibold">
            {k.receivables}
          </h2>
          <span className="tabular text-sm font-semibold">{money(r.total)}</span>
        </header>
        <dl className="mt-3 grid grid-cols-5 gap-2 px-5 text-center">
          {buckets.map(([key, label]) => (
            <div key={key} className={clsx("rounded-lg p-2", key === "current" ? "bg-muted" : r.buckets[key] ? "bg-danger/10" : "bg-muted")}>
              <dt className="text-[10px] text-fg-muted">{label}</dt>
              <dd className={clsx("tabular text-xs font-semibold", key !== "current" && r.buckets[key] ? "text-danger" : "")}>{money(r.buckets[key])}</dd>
            </div>
          ))}
        </dl>
        {r.customers.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-muted">{k.noDebts}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {r.customers.slice(0, 15).map((c) => (
              <li key={c.contact.id}>
                <Link href={`/crm/${c.contact.id}`} className="flex items-center gap-3 px-5 py-2 text-sm hover:bg-muted">
                  <span className="min-w-0 flex-1 truncate font-medium">{c.contact.name}</span>
                  <span className="text-xs text-fg-subtle">{interpolate(t.value.invoices, { n: c.invoices })}</span>
                  {c.daysLate > 0 && <span className="text-xs text-danger">{interpolate(k.daysLate, { n: c.daysLate })}</span>}
                  {c.oldestDueDate && c.daysLate === 0 && <span className="text-xs text-fg-subtle">{formatDate(c.oldestDueDate, locale)}</span>}
                  <span className="tabular w-24 text-right">{money(c.due)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card relative overflow-x-auto" aria-labelledby="product-sales">
        <h2 id="product-sales" className="px-5 pt-4 text-sm font-semibold">
          {k.products}
        </h2>
        {p.rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-muted">{t.analytics.empty}</p>
        ) : (
          <table className="mt-2 w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-subtle">
                <th scope="col" className="px-5 py-2 font-medium">{k.product}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{k.quantity}</th>
                <th scope="col" className="px-5 py-2 text-right font-medium">{k.revenue}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.rows.map((row) => (
                <tr key={row.productId ?? row.name}>
                  <td className="max-w-0 truncate px-5 py-2">{row.name}</td>
                  <td className="tabular px-3 text-right">{formatNumber(row.quantity, locale, row.quantity % 1 ? 2 : 0)}</td>
                  <td className="tabular px-5 text-right">{formatMoney(row.revenue, locale, p.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
