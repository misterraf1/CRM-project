import type { DocDto, DocSettings, PublicDocDto } from "@/shared";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocActions } from "@/components/sales/DocActions";
import { DocEditor } from "@/components/sales/DocEditor";
import { DocStatusBadge } from "@/components/sales/DocStatusBadge";
import { DocumentSheet } from "@/components/sales/DocumentSheet";
import { getContact, getContacts, getCurrencySettings, getDoc, getDocSettings, getProducts, getSession } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { formatDate } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Document" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> };

/** The customer's view of the document, built from the internal one. */
function sheet(doc: DocDto, company: string, settings: DocSettings, customer: PublicDocDto["customer"], locale: string): PublicDocDto {
  return {
    kind: doc.kind,
    number: doc.number,
    status: doc.status,
    expired: doc.expired,
    company: {
      name: company,
      legalName: settings.legalName ?? null,
      taxId: settings.taxId ?? null,
      address: settings.address ?? null,
      bankDetails: settings.bankDetails ?? null,
      terms: settings.terms ?? null,
      logo: settings.logo,
    },
    customer,
    currency: doc.currency,
    lines: doc.lines,
    subtotal: doc.subtotal,
    discountTotal: doc.discountTotal,
    taxTotal: doc.taxTotal,
    total: doc.total,
    paidAmount: doc.paidAmount,
    issueDate: doc.issueDate,
    dueDate: doc.dueDate,
    notes: doc.notes,
    response: doc.response,
    locale,
    order: null,
  };
}

export default async function DocPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const doc = await getDoc(id).catch((e) => {
    if (e instanceof ApiRequestError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const [{ t, locale }, me] = await Promise.all([getI18n(), getSession()]);
  const k = t.sales;
  const canWrite = me.permissions.includes(doc.kind === "quote" ? "quotes.manage" : "invoices.manage");
  const editable = canWrite && (doc.status === "draft" || (doc.kind === "quote" && doc.status === "sent"));
  const back = (
    <Link href={`/sales?kind=${doc.kind}`} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg print:hidden">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {doc.kind === "quote" ? k.quotes : k.invoices}
    </Link>
  );

  if (sp.edit === "1" && editable) {
    const [contacts, currencies, products] = await Promise.all([getContacts({ limit: "100" }), getCurrencySettings(), getProducts()]);
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        {back}
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{interpolate(k.editTitle, { number: doc.number ?? k.draftNumber })}</h1>
        {doc.kind === "quote" && doc.status === "sent" && <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">{k.editSentHint}</p>}
        <DocEditor
          kind={doc.kind}
          doc={doc}
          contacts={contacts.items.map((c) => ({ id: c.id, name: c.name }))}
          defaults={{}}
          products={products}
          currencies={currencies.available.includes(doc.currency) ? currencies.available : [doc.currency, ...currencies.available]}
        />
      </div>
    );
  }

  const [settings, contact] = await Promise.all([getDocSettings(), doc.contact ? getContact(doc.contact.id).catch(() => null) : null]);
  const customer = {
    name: doc.contact?.name ?? "",
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    companyName: contact?.companyName ?? null,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {back}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          {doc.kind === "quote" ? k.quoteTitle : k.invoiceTitle} <span className="font-mono text-base text-fg-muted">{doc.number ?? k.draftNumber}</span>
        </h1>
        <DocStatusBadge doc={doc} t={t} />
        {doc.deal && (
          <Link href={`/deals/${doc.deal.id}`} className="text-sm text-accent hover:underline">
            {doc.deal.title}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted print:hidden">
        {doc.owner && <span>{interpolate(k.ownerLine, { name: doc.owner.name })}</span>}
        {doc.sentAt && <span>{interpolate(k.sentLine, { date: formatDate(doc.sentAt, locale, "long") })}</span>}
        {doc.response && (
          <span>
            {interpolate(doc.response.decision === "accept" ? k.answeredAccept : k.answeredReject, { name: doc.response.name, date: formatDate(doc.response.at, locale, "long") })}
            {doc.response.comment && ` — «${doc.response.comment}»`}
          </span>
        )}
        {doc.sourceId && (
          <Link href={`/sales/${doc.sourceId}`} className="text-accent hover:underline">
            {k.fromQuote}
          </Link>
        )}
        {doc.orders.map((o) => (
          <Link key={o.id} href={`/orders/${o.id}`} className="text-accent hover:underline">
            {interpolate(k.orderLink, { number: o.number })}
          </Link>
        ))}
        {doc.invoices.map((i) => (
          <Link key={i.id} href={`/sales/${i.id}`} className="text-accent hover:underline">
            {interpolate(k.invoiceLink, { number: i.number ?? k.draftNumber })}
          </Link>
        ))}
      </div>
      <DocActions doc={doc} permissions={me.permissions} contactEmail={contact?.email ?? null} />
      <DocumentSheet doc={sheet(doc, me.tenant.name, settings, customer, locale)} t={t} locale={locale} nested />
    </div>
  );
}
