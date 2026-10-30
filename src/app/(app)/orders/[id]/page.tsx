import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderProgress, OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { OrderView } from "@/components/orders/OrderView";
import { getMembers, getOrder } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { formatMoneyExact } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Order" };

type Props = { params: Promise<{ id: string }> };

export default async function OrderPage({ params }: Props) {
  const { id } = await params;
  const order = await getOrder(id).catch((e) => {
    if (e instanceof ApiRequestError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const [{ t, locale }, members] = await Promise.all([getI18n(), getMembers()]);
  const k = t.orders;
  return (
    <div className="space-y-4">
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {k.back}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">
          {order.title} <span className="font-mono text-base text-fg-muted">{order.number}</span>
        </h1>
        <OrderStatusBadge order={order} t={t} />
        <OrderProgress done={order.progress.done} total={order.progress.total} label={k.progress} />
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
        {order.contact && (
          <Link href={`/crm/${order.contact.id}`} className="hover:text-accent">
            {order.contact.name}
          </Link>
        )}
        {order.quote && (
          <Link href={`/sales/${order.quote.id}`} className="text-accent hover:underline">
            {interpolate(k.fromQuote, { number: order.quote.number ?? "" })}
          </Link>
        )}
        {order.deal && (
          <Link href={`/deals/${order.deal.id}`} className="hover:text-accent">
            {order.deal.title}
          </Link>
        )}
        {order.total > 0 && <span className="tabular font-medium text-fg">{formatMoneyExact(order.total, locale, order.currency)}</span>}
        {order.owner && <span>{t.sales.owner}: {order.owner.name}</span>}
      </p>
      <OrderView order={order} members={members} />
    </div>
  );
}
