import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { RevenueChart } from "@/components/admin/RevenueChart";
import { StatTile } from "@/components/ui/StatTile";
import { getAdminOverview } from "@/lib/api/admin";
import { SUBSCRIPTION_STATUS_STYLE } from "@/lib/billing";
import { formatMoney, formatNumber } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  const [{ t, locale }, o] = await Promise.all([getI18n(), getAdminOverview()]);
  const k = t.admin.overview;
  const money = (v: number) => formatMoney(v, locale, o.currency);
  const statuses = ["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"] as const;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label={k.mrr} value={money(o.mrr)} hint={k.mrrHint} />
        <StatTile label={k.arr} value={money(o.arr)} />
        <StatTile label={k.profit30d} value={money(o.profit30d)} tone={o.profit30d < 0 ? "danger" : undefined} hint={`${k.revenue}: ${money(o.revenue30d)} · ${k.expenses}: ${money(o.expenses30d)}`} />
        <StatTile label={k.signups30d} value={formatNumber(o.signups30d, locale)} hint={`${k.churn30d}: ${o.churned30d} (${formatNumber(o.churnRate * 100, locale, 1)}%)`} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold">{k.months}</h2>
          <RevenueChart months={o.months} locale={locale} t={t} />
        </section>
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="text-sm font-semibold">
              {k.tenants} · <span className="tabular">{o.tenants.total}</span>
            </h2>
            <ul className="mt-3 space-y-2">
              {statuses.map((s) => (
                <li key={s}>
                  <Link href={`/admin/tenants?status=${s}`} className="flex items-center justify-between rounded-lg px-2 py-1 text-sm hover:bg-muted">
                    <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", SUBSCRIPTION_STATUS_STYLE[s])}>{t.admin.statuses[s]}</span>
                    <span className="tabular font-medium">{o.tenants[s]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/admin/billing?status=FAILED" className="block">
              <StatTile label={k.failedPayments7d} value={formatNumber(o.failedPayments7d, locale)} tone={o.failedPayments7d ? "danger" : undefined} />
            </Link>
            <Link href="/admin/tickets" className="block">
              <StatTile label={k.openTickets} value={formatNumber(o.openTickets, locale)} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
