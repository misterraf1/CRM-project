import type { PublicDocDto } from "@/shared";
import { CheckCircle2, Circle } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/billing/PrintButton";
import { DocumentSheet } from "@/components/sales/DocumentSheet";
import { QuoteResponseForm } from "@/components/sales/QuoteResponseForm";
import { apiPublic } from "@/lib/api/server";
import { formatDate } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Document", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ token: string }> };

/** The customer's page behind a quote or invoice link: view, save as PDF, answer a quote. */
export default async function PublicDocPage({ params }: Props) {
  const { token } = await params;
  const res = await apiPublic<PublicDocDto>(`/v1/public/docs/${encodeURIComponent(token)}`);
  if (!res.ok) notFound();
  const doc = res.data;
  const { t, locale } = await getI18n();
  const k = t.sales;
  const open = doc.kind === "quote" && doc.status === "sent" && !doc.expired;

  return (
    <main className="min-h-screen bg-muted/40 px-4 py-8 print:min-h-0 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-fg-muted">{interpolate(k.publicFrom, { company: doc.company.name })}</p>
          <PrintButton label={k.printPdf} />
        </div>
        <DocumentSheet doc={doc} t={t} locale={locale} />
        {doc.order && (
          <section className="card p-5 print:hidden" aria-labelledby="order-progress">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="order-progress" className="text-sm font-semibold">
                {t.orders.publicTitle} <span className="font-mono text-xs text-fg-muted">{doc.order.number}</span>
              </h2>
              <span className="text-xs font-medium text-accent">{t.orders.statuses[doc.order.status]}</span>
            </div>
            {doc.order.deliveryDate && <p className="mt-1 text-xs text-fg-muted">{interpolate(t.orders.publicDelivery, { date: formatDate(doc.order.deliveryDate, locale, "long") })}</p>}
            <ol className="mt-3 space-y-2">
              {doc.order.steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  {s.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label={t.orders.done} /> : <Circle className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />}
                  <span className={s.done ? "text-fg-muted" : ""}>{s.title}</span>
                  {s.dueDate && !s.done && <span className="ml-auto text-xs text-fg-subtle">{formatDate(s.dueDate, locale, "short")}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className="print:hidden">
          {open && <QuoteResponseForm token={token} />}
          {doc.response && (
            <p role="status" className="card p-4 text-sm">
              {interpolate(doc.response.decision === "accept" ? k.answeredAccept : k.answeredReject, {
                name: doc.response.name,
                date: formatDate(doc.response.at, locale, "long"),
              })}
            </p>
          )}
          {doc.kind === "quote" && doc.expired && <p className="card p-4 text-sm text-fg-muted">{k.expiredHint}</p>}
        </div>
      </div>
    </main>
  );
}
