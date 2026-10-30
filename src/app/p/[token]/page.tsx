import type { PublicDocDto } from "@/shared";
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
