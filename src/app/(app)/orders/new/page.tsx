import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { OrderForm } from "@/components/orders/OrderForm";
import { getContacts, getDoc, getDocSettings, getMembers, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "New order" };

type Props = { searchParams: Promise<{ quoteId?: string; contactId?: string }> };

export default async function NewOrderPage({ searchParams }: Props) {
  const [{ t }, me, sp] = await Promise.all([getI18n(), getSession(), searchParams]);
  const k = t.orders;
  if (!me.permissions.includes("orders.manage")) return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;
  const [contacts, members, settings, quote] = await Promise.all([
    getContacts({ limit: "100" }),
    getMembers(),
    getDocSettings(),
    sp.quoteId ? getDoc(sp.quoteId).catch(() => null) : null,
  ]);
  const options = contacts.items.map((c) => ({ id: c.id, name: c.name }));
  if (quote?.contact && !options.some((c) => c.id === quote.contact!.id)) options.unshift(quote.contact);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {k.back}
      </Link>
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.new}</h1>
      <OrderForm
        contacts={options}
        members={members}
        defaults={{
          title: quote ? `${quote.number ?? ""} · ${quote.contact?.name ?? ""}` : "",
          contactId: quote?.contact?.id ?? sp.contactId,
          dealId: quote?.deal?.id ?? null,
          quote: quote ? { id: quote.id, number: quote.number } : null,
          steps: settings.orderSteps ?? [],
        }}
      />
    </div>
  );
}
