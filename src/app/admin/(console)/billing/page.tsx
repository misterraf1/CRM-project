import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { StatTile } from "@/components/ui/StatTile";
import { getAdminInvoices } from "@/lib/api/admin";
import { INVOICE_STATUS_STYLE } from "@/lib/billing";
import { formatDate, formatMoney } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Payments" };

const FILTERS = ["OPEN", "PAID", "FAILED", "VOID"] as const;
const PAGE = 25;

type Props = { searchParams: Promise<{ status?: string; page?: string }> };

export default async function AdminBillingPage({ searchParams }: Props) {
  const sp = await searchParams;
  const status = FILTERS.find((s) => s === sp.status);
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ t, locale }, list] = await Promise.all([getI18n(), getAdminInvoices({ status, page: String(page) })]);
  const k = t.admin.billing;
  const pages = Math.max(1, Math.ceil(list.total / PAGE));
  const href = (s?: string, p = 1) => `/admin/billing?${new URLSearchParams({ ...(s ? { status: s } : {}), page: String(p) })}`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <StatTile label={k.totalPaid} value={formatMoney(list.totals.paid, locale)} />
        <StatTile label={k.totalFailed} value={formatMoney(list.totals.failed, locale)} tone={list.totals.failed ? "danger" : undefined} />
      </div>
      <nav className="flex flex-wrap gap-1" aria-label={k.status}>
        {[undefined, ...FILTERS].map((s) => (
          <Link
            key={s ?? "all"}
            href={href(s)}
            aria-current={status === s ? "page" : undefined}
            className={clsx("rounded-lg px-3 py-1.5 text-xs font-medium", status === s ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-muted")}
          >
            {s ? t.billing.invoiceStatuses[s] : k.all}
          </Link>
        ))}
      </nav>
      <div className="card relative overflow-x-auto">
        {list.items.length === 0 ? (
          <p className="p-6 text-sm text-fg-muted">{k.empty}</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-subtle">
                <th scope="col" className="px-4 py-2 font-medium">{k.number}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.company}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.kind}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{k.amount}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.status}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.failure}</th>
                <th scope="col" className="px-4 py-2 font-medium">{k.created}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2.5 font-mono text-xs">{i.number}</td>
                  <td className="px-3">
                    <Link href={`/admin/tenants/${i.tenantId}`} className="hover:text-accent">
                      {i.company}
                    </Link>
                  </td>
                  <td className="px-3 text-xs">{t.billing.invoiceKinds[i.kind]}</td>
                  <td className="tabular px-3 text-right font-medium">{formatMoney(i.amount, locale, i.currency)}</td>
                  <td className="px-3">
                    <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", INVOICE_STATUS_STYLE[i.status] ?? "bg-muted text-fg-muted")}>{t.billing.invoiceStatuses[i.status]}</span>
                  </td>
                  <td className="px-3 font-mono text-xs text-fg-muted">{i.failureCode ?? ""}</td>
                  <td className="whitespace-nowrap px-4 text-xs text-fg-muted">{formatDate(i.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <nav className="flex items-center justify-end gap-2" aria-label={k.title}>
          {page > 1 && (
            <Link href={href(status, page - 1)} className="btn-ghost h-8 border border-border text-xs">
              {t.admin.tenants.prev}
            </Link>
          )}
          <span className="tabular text-xs text-fg-muted">
            {page} / {pages}
          </span>
          {page < pages && (
            <Link href={href(status, page + 1)} className="btn-ghost h-8 border border-border text-xs">
              {t.admin.tenants.next}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
