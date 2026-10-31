import type { PublicDocDto } from "@/shared";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/billing/PrintButton";
import { DocumentSheet } from "@/components/sales/DocumentSheet";
import { QuoteResponseForm } from "@/components/sales/QuoteResponseForm";
import { apiPublic } from "@/lib/api/server";
import { formatDate } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Document", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ token: string; docId: string }> };

/** A document from the customer's portal: view, save as PDF, answer a quote. */
export default async function PortalDocPage({ params }: Props) {
  const { token, docId } = await params;
  const base = `/v1/public/portal/${encodeURIComponent(token)}/docs/${encodeURIComponent(docId)}`;
  const res = await apiPublic<PublicDocDto>(base);
  if (!res.ok) notFound();
  const doc = res.data;
  const { t, locale } = await getI18n();
  const k = t.sales;
  const open = doc.kind === "quote" && doc.status === "sent" && !doc.expired;
  return (
    <main className="min-h-screen bg-muted/40 px-4 py-8 print:min-h-0 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href={`/c/${token}`} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t.portal.back}
          </Link>
          <PrintButton label={k.printPdf} />
        </div>
        <DocumentSheet doc={doc} t={t} locale={locale} />
        <div className="print:hidden">
          {open && <QuoteResponseForm token={token} endpoint={`/api${base}/respond`} />}
          {doc.response && (
            <p role="status" className="card p-4 text-sm">
              {interpolate(doc.response.decision === "accept" ? k.answeredAccept : k.answeredReject, { name: doc.response.name, date: formatDate(doc.response.at, locale, "long") })}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
