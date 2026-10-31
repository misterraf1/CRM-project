import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminUsage } from "@/lib/api/admin";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Usage" };

/** Metered use per company: who is close to their limits, who is quiet. */
export default async function AdminUsagePage() {
  const [{ t, locale }, rows] = await Promise.all([getI18n(), getAdminUsage()]);
  const k = t.usage;
  const near = (used: number, limit: number) => limit > 0 && used / limit >= 0.8;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      <section className="card relative overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-fg-subtle">
              <th scope="col" className="px-4 py-2 font-medium">{k.company}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{k.members}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{k.contacts}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{k.storage}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{k.ai}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{k.emails}</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">{k.lastLogin}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.tenant.id}>
                <td className="px-4 py-2">
                  <Link href={`/admin/tenants/${r.tenant.id}`} className="font-medium hover:text-accent">
                    {r.tenant.name}
                  </Link>
                  <span className="ml-2 text-xs text-fg-subtle">
                    {r.tenant.plan} · {t.admin.statuses[r.tenant.status as keyof typeof t.admin.statuses] ?? r.tenant.status}
                  </span>
                </td>
                <td className="tabular px-3 text-right">{r.members}</td>
                <td className="tabular px-3 text-right">{formatNumber(r.contacts, locale)}</td>
                <td className={clsx("tabular px-3 text-right", near(r.storageMb.used, r.storageMb.limit) && "font-medium text-warning")}>
                  {formatNumber(r.storageMb.used, locale)} / {formatNumber(r.storageMb.limit, locale)}
                </td>
                <td className={clsx("tabular px-3 text-right", near(r.ai.used, r.ai.limit) && "font-medium text-warning")}>
                  {r.ai.used} / {r.ai.limit}
                </td>
                <td className="tabular px-3 text-right">{formatNumber(r.emails30d, locale)}</td>
                <td className="px-4 text-right text-xs text-fg-muted">{r.lastLoginAt ? formatDateTime(r.lastLoginAt, locale) : k.never}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
