import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { getAdminTenants } from "@/lib/api/admin";
import { formatDate, formatMoney } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Companies" };

const PAGE = 25;
const STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"] as const;

type Props = { searchParams: Promise<{ q?: string; status?: string; page?: string }> };

export default async function AdminTenantsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ t, locale }, list] = await Promise.all([getI18n(), getAdminTenants({ q: sp.q, status, page: String(page) })]);
  const k = t.admin.tenants;
  const pages = Math.max(1, Math.ceil(list.total / PAGE));
  const link = (p: number) => `/admin/tenants?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(status ? { status } : {}), page: String(p) })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">{interpolate(k.total, { n: list.total })}</p>
        </div>
        <form action="/admin/tenants" className="flex w-full flex-wrap gap-2 sm:w-auto">
          <label className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <span className="sr-only">{k.search}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input name="q" defaultValue={sp.q} placeholder={k.search} className="input mt-0 pl-8" />
          </label>
          <label>
            <span className="sr-only">{k.status}</span>
            <select name="status" defaultValue={status ?? ""} className="input mt-0 w-auto">
              <option value="">{k.allStatuses}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t.admin.statuses[s]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-primary">
            <Search className="h-4 w-4" aria-hidden />
            <span className="sr-only">{k.search}</span>
          </button>
        </form>
      </div>

      <div className="card relative overflow-x-auto">
        {list.items.length === 0 ? (
          <p className="p-6 text-sm text-fg-muted">{k.empty}</p>
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-subtle">
                <th scope="col" className="px-4 py-2 font-medium">{k.company}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.plan}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.status}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{k.seats}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{k.mrr}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.owner}</th>
                <th scope="col" className="px-4 py-2 font-medium">{k.created}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.items.map((row) => (
                <tr key={row.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/tenants/${row.id}`} className="font-medium hover:text-accent">
                      {row.name}
                    </Link>
                    <p className="text-xs text-fg-subtle">{row.slug}</p>
                  </td>
                  <td className="px-3">{row.plan}</td>
                  <td className="px-3">
                    <StatusBadge status={row.status} label={t.admin.statuses[row.status]} />
                  </td>
                  <td className="tabular px-3 text-right">
                    {row.seats.used}/{row.seats.limit}
                  </td>
                  <td className="tabular px-3 text-right">{formatMoney(row.mrr, locale)}</td>
                  <td className="max-w-[200px] truncate px-3 text-xs text-fg-muted">{row.ownerEmail ?? k.none}</td>
                  <td className="whitespace-nowrap px-4 text-xs text-fg-muted">{formatDate(row.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <nav className="flex items-center justify-end gap-2 text-sm" aria-label={k.title}>
          {page > 1 && (
            <Link href={link(page - 1)} className="btn-ghost h-8 border border-border text-xs">
              {k.prev}
            </Link>
          )}
          <span className="tabular text-xs text-fg-muted">
            {page} / {pages}
          </span>
          {page < pages && (
            <Link href={link(page + 1)} className="btn-ghost h-8 border border-border text-xs">
              {k.next}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
