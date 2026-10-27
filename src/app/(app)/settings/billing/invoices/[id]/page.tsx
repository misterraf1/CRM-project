import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/billing/PrintButton";
import { getInvoice } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { invoiceLineText } from "@/lib/billing";
import { APP_NAME } from "@/lib/config";
import { formatDate, formatMoney } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Invoice" };

type Props = { params: Promise<{ id: string }> };

export default async function InvoicePage({ params }: Props) {
  const { id } = await params;
  const inv = await getInvoice(id).catch((e) => {
    if (e instanceof ApiRequestError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const { t, locale } = await getI18n();
  const k = t.invoice;
  const money = (n: number) => formatMoney(n, locale, inv.currency);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/settings/billing" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {k.back}
        </Link>
        <PrintButton label={k.print} />
      </div>
      <article className="card p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap justify-between gap-4">
          <div>
            <p className="text-2xl font-semibold">{k.title}</p>
            <p className="font-mono text-sm text-fg-muted">{inv.number}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{APP_NAME}</p>
            <p className="text-fg-muted">{k.seller}</p>
          </div>
        </header>
        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-fg-subtle">{k.billedTo}</dt>
            <dd className="font-medium">{inv.company}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">{k.issued}</dt>
            <dd>{formatDate(inv.createdAt, locale, "long")}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">{k.period}</dt>
            <dd>
              {formatDate(inv.periodStart, locale, "short")} – {formatDate(inv.periodEnd, locale, "short")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">{k.status}</dt>
            <dd className="font-medium">{t.billing.invoiceStatuses[inv.status]}</dd>
          </div>
        </dl>
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-fg-subtle">
              <th scope="col" className="py-2 font-medium">{k.description}</th>
              <th scope="col" className="py-2 text-right font-medium">{k.qty}</th>
              <th scope="col" className="py-2 text-right font-medium">{k.unit}</th>
              <th scope="col" className="py-2 text-right font-medium">{k.amount}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {inv.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-2">{invoiceLineText(l, t)}</td>
                <td className="tabular py-2 text-right">{l.quantity}</td>
                <td className="tabular py-2 text-right">{money(l.unitAmount)}</td>
                <td className="tabular py-2 text-right">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-fg/20">
              <td colSpan={3} className="py-3 text-right font-semibold">
                {k.total}
              </td>
              <td className="tabular py-3 text-right text-lg font-semibold">{money(inv.amount)}</td>
            </tr>
          </tfoot>
        </table>
        {inv.payments.length > 0 && (
          <p className="mt-4 text-xs text-fg-subtle">
            {inv.payments.map((p) => `${formatDate(p.createdAt, locale, "short")} · ${p.provider} · ${p.status}${p.failureCode ? ` (${p.failureCode})` : ""}`).join("  ·  ")}
          </p>
        )}
      </article>
    </div>
  );
}
