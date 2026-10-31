import type { DocKind } from "@/shared";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DocEditor } from "@/components/sales/DocEditor";
import { getContacts, getCurrencySettings, getDeal, getProducts, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "New document" };

type Props = { searchParams: Promise<{ kind?: string; dealId?: string; contactId?: string }> };

export default async function NewDocPage({ searchParams }: Props) {
  const [{ t }, me, sp] = await Promise.all([getI18n(), getSession(), searchParams]);
  const k = t.sales;
  const kind: DocKind = sp.kind === "invoice" ? "invoice" : "quote";
  if (!me.permissions.includes(kind === "quote" ? "quotes.manage" : "invoices.manage")) return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;
  const [contacts, currencies, products, deal] = await Promise.all([
    getContacts({ limit: "100" }),
    getCurrencySettings(),
    getProducts(),
    sp.dealId ? getDeal(sp.dealId).catch(() => null) : null,
  ]);
  const contactId = sp.contactId ?? deal?.contact?.id;
  const options = contacts.items.map((c) => ({ id: c.id, name: c.name }));
  // The deal's customer may be outside the first page of contacts
  if (deal?.contact && !options.some((c) => c.id === deal.contact!.id)) options.unshift({ id: deal.contact.id, name: deal.contact.name });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href={`/sales?kind=${kind}`} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {kind === "quote" ? k.quotes : k.invoices}
      </Link>
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{kind === "quote" ? k.newQuote : k.newInvoice}</h1>
      <DocEditor
        kind={kind}
        contacts={options}
        defaults={{ contactId, deal: deal ? { id: deal.id, title: deal.title } : null }}
        products={products}
        currencies={currencies.available}
      />
    </div>
  );
}
