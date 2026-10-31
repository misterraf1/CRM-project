import { ORDER_STATUSES } from "@/shared";
import { EmptyState } from "@/components/ui/EmptyState";
import clsx from "clsx";
import { PackageCheck, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { OrderProgress, OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { getOrders, getSession } from "@/lib/api";
import { formatDate, formatMoneyExact } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Orders" };

const FILTERS = [...ORDER_STATUSES, "overdue"] as const;

type Props = { searchParams: Promise<{ status?: string }> };

export default async function OrdersPage({ searchParams }: Props) {
  const [{ t, locale }, me, sp] = await Promise.all([getI18n(), getSession(), searchParams]);
  const k = t.orders;
  if (!me.permissions.includes("orders.manage")) return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;
  const status = (FILTERS as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const orders = await getOrders({ status });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
        </div>
        <Link href="/orders/new" className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden />
          {k.new}
        </Link>
      </div>
      <section className="card">
        <nav aria-label={k.title} className="flex flex-wrap gap-1 border-b border-border p-3">
          {[undefined, ...FILTERS].map((s) => (
            <Link
              key={s ?? "all"}
              href={s ? `/orders?status=${s}` : "/orders"}
              aria-current={status === s ? "true" : undefined}
              className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", status === s ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-muted hover:text-fg")}
            >
              {s ? k.statuses[s] : k.all}
            </Link>
          ))}
        </nav>
        {orders.length === 0 ? (
          <EmptyState icon={PackageCheck} title={k.noOrders} hint={t.empties.orders.hint} action={{ href: "/orders/new", label: k.new }} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-fg-subtle">
                  <th scope="col" className="px-4 py-2 font-medium">№</th>
                  <th scope="col" className="px-3 py-2 font-medium">{k.name}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{k.customer}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{k.progress}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t.sales.status}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{k.dueDate}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{k.total}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{k.owner}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/orders/${o.id}`} className="font-mono text-xs font-medium text-accent hover:underline">
                        {o.number}
                      </Link>
                    </td>
                    <td className="max-w-[16rem] truncate px-3">{o.title}</td>
                    <td className="px-3 text-fg-muted">{o.contact?.name ?? "—"}</td>
                    <td className="px-3">
                      <OrderProgress done={o.progress.done} total={o.progress.total} label={`${k.progress}: ${o.number}`} />
                    </td>
                    <td className="px-3">
                      <OrderStatusBadge order={o} t={t} />
                    </td>
                    <td className="whitespace-nowrap px-3 text-xs text-fg-muted">{o.dueDate ? formatDate(o.dueDate, locale, "short") : "—"}</td>
                    <td className="tabular whitespace-nowrap px-3 text-right">{o.total ? formatMoneyExact(o.total, locale, o.currency) : "—"}</td>
                    <td className="px-4 text-xs text-fg-muted">{o.owner?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
