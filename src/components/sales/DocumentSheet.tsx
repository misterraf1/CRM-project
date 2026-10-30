import type { PublicDocDto } from "@/shared";
import { formatDate, formatMoneyExact, formatNumber } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import type { Locale } from "@/lib/i18n/locales";

const percent = (bp: number, locale: Locale) => `${formatNumber(bp / 100, locale, bp % 100 ? 2 : 0)}%`;

/** 1.5 → "1,5"; trailing zeros dropped (quantities have at most 3 decimals). */
export const formatQuantity = (q: number, locale: Locale) => formatNumber(q, locale, (String(q).split(".")[1] ?? "").length);

/**
 * A quote or invoice as the customer sees it — on the link page and when printed
 * (the browser's "Save as PDF" makes the PDF). Plain markup, no client code.
 */
export function DocumentSheet({ doc, t, locale, nested = false }: { doc: PublicDocDto; t: Dictionary; locale: Locale; /** Inside a page with its own h1 */ nested?: boolean }) {
  const Title = nested ? "h2" : "h1";
  const k = t.sales;
  const money = (n: number) => formatMoneyExact(n, locale, doc.currency);
  const date = (iso: string | null) => (iso ? `${formatDate(iso, locale, "long")} ${new Date(iso).getUTCFullYear()}` : "—");
  const c = doc.company;
  const hasDiscount = doc.lines.some((l) => l.discountBp > 0);
  const hasTax = doc.lines.some((l) => l.taxBp > 0);
  const due = doc.total - doc.paidAmount;
  const stamp =
    doc.status === "accepted" ? k.statuses.accepted : doc.status === "rejected" ? k.statuses.rejected : doc.status === "paid" ? k.statuses.paid : doc.expired ? k.statuses.expired : null;

  return (
    <article className="card relative overflow-hidden p-6 text-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
      {stamp && (
        <p className="absolute right-6 top-6 rotate-6 rounded-md border-2 border-current px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-fg-muted print:right-0 print:top-0">
          {stamp}
        </p>
      )}
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          {c.logo && (
            // A data: URI chosen by the company (validated PNG/JPEG/WebP); next/image doesn't apply
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.logo} alt={c.legalName ?? c.name} className="mb-2 max-h-14 max-w-[12rem] object-contain" />
          )}
          <p className="text-xl font-semibold">{c.legalName ?? c.name}</p>
          {c.taxId && <p className="text-xs text-fg-muted">{interpolateTax(k.taxId, c.taxId)}</p>}
          {c.address && <p className="text-xs text-fg-muted">{c.address}</p>}
        </div>
        <div className="sm:text-right">
          <Title className="text-2xl font-semibold tracking-tight">{doc.kind === "quote" ? k.quoteTitle : k.invoiceTitle}</Title>
          <p className="font-mono text-sm text-fg-muted">{doc.number ?? k.draftNumber}</p>
        </div>
      </header>

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-fg-subtle">{k.billedTo}</dt>
          <dd className="font-medium">{doc.customer.name}</dd>
          {doc.customer.companyName && <dd className="text-xs text-fg-muted">{doc.customer.companyName}</dd>}
          {doc.customer.email && <dd className="text-xs text-fg-muted">{doc.customer.email}</dd>}
          {doc.customer.phone && <dd className="text-xs text-fg-muted">{doc.customer.phone}</dd>}
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">{k.issueDate}</dt>
          <dd>{date(doc.issueDate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">{doc.kind === "quote" ? k.validUntil : k.dueDate}</dt>
          <dd>{date(doc.dueDate)}</dd>
        </div>
      </dl>

      <div className="relative mt-6 overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[520px] text-sm print:min-w-0">
          <thead>
            <tr className="border-b border-border text-left text-xs text-fg-subtle">
              <th scope="col" className="py-2 pr-2 font-medium">#</th>
              <th scope="col" className="py-2 pr-2 font-medium">{k.item}</th>
              <th scope="col" className="py-2 pr-2 text-right font-medium">{k.quantity}</th>
              <th scope="col" className="py-2 pr-2 text-right font-medium">{k.unitPrice}</th>
              {hasDiscount && <th scope="col" className="py-2 pr-2 text-right font-medium">{k.discount}</th>}
              {hasTax && <th scope="col" className="py-2 pr-2 text-right font-medium">{k.tax}</th>}
              <th scope="col" className="py-2 text-right font-medium">{k.lineTotal}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {doc.lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="tabular py-2 pr-2 text-fg-subtle">{i + 1}</td>
                <td className="py-2 pr-2">
                  <p className="font-medium">{l.name}</p>
                  {l.description && <p className="whitespace-pre-line text-xs text-fg-muted">{l.description}</p>}
                </td>
                <td className="tabular whitespace-nowrap py-2 pr-2 text-right">
                  {formatQuantity(l.quantity, locale)} {l.unit}
                </td>
                <td className="tabular whitespace-nowrap py-2 pr-2 text-right">{money(l.unitPrice)}</td>
                {hasDiscount && <td className="tabular py-2 pr-2 text-right">{l.discountBp ? percent(l.discountBp, locale) : "—"}</td>}
                {hasTax && <td className="tabular py-2 pr-2 text-right">{l.taxBp ? percent(l.taxBp, locale) : "—"}</td>}
                <td className="tabular whitespace-nowrap py-2 text-right font-medium">{money(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto mt-4 w-full max-w-xs space-y-1">
        <Total label={k.subtotal} value={money(doc.subtotal)} />
        {doc.discountTotal > 0 && <Total label={k.discountTotal} value={`−${money(doc.discountTotal)}`} />}
        {doc.taxTotal > 0 && <Total label={k.taxTotal} value={money(doc.taxTotal)} />}
        <Total label={k.total} value={money(doc.total)} strong />
        {doc.kind === "invoice" && doc.paidAmount > 0 && (
          <>
            <Total label={k.paid} value={money(doc.paidAmount)} />
            <Total label={k.amountDue} value={money(due)} strong />
          </>
        )}
      </dl>

      {(doc.notes || c.terms || c.bankDetails) && (
        <div className="mt-6 grid gap-4 border-t border-border pt-4 text-xs text-fg-muted sm:grid-cols-2">
          {(doc.notes || c.terms) && (
            <div className="space-y-2">
              {doc.notes && <p className="whitespace-pre-line">{doc.notes}</p>}
              {c.terms && <p className="whitespace-pre-line">{c.terms}</p>}
            </div>
          )}
          {c.bankDetails && (
            <div>
              <p className="font-medium text-fg">{k.bankDetails}</p>
              <p className="whitespace-pre-line">{c.bankDetails}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

const interpolateTax = (template: string, taxId: string) => template.replace("{taxId}", taxId);

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between gap-4 border-t border-border pt-1 text-base font-semibold" : "flex justify-between gap-4 text-fg-muted"}>
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
