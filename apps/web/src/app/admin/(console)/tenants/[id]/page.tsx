import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { TenantActions } from "@/components/admin/TenantActions";
import { getAdminMe, getAdminTenant } from "@/lib/api/admin";
import { ApiRequestError } from "@/lib/api/server";
import { INVOICE_STATUS_STYLE } from "@/lib/billing";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Company" };

type Props = { params: Promise<{ id: string }> };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default async function AdminTenantPage({ params }: Props) {
  const { id } = await params;
  const d = await getAdminTenant(id).catch((e) => {
    if (e instanceof ApiRequestError && e.status === 404) notFound();
    throw e;
  });
  const [{ t, locale }, me] = await Promise.all([getI18n(), getAdminMe()]);
  const k = t.admin.tenants;
  const s = d.subscription;
  const date = (iso: string | null) => (iso ? formatDate(iso, locale, "long") : k.none);

  return (
    <div className="space-y-5">
      <Link href="/admin/tenants" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {k.back}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{d.name}</h1>
        <StatusBadge status={d.status} label={t.admin.statuses[d.status]} />
        <span className="text-sm text-fg-muted">
          {d.slug} · {d.plan} · {formatMoney(d.mrr, locale)}{t.billing.perMonth}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-3">
        <section className="card p-5">
          <h2 className="text-sm font-semibold">{k.subscription}</h2>
          <dl className="mt-2 divide-y divide-border">
            <Row label={k.plan}>{d.plan}</Row>
            <Row label={k.interval}>{k.intervals[d.interval]}</Row>
            {s.trialEndsAt && d.status === "TRIALING" && <Row label={k.trialEnds}>{date(s.trialEndsAt)}</Row>}
            <Row label={k.periodEnds}>{date(s.currentPeriodEnd)}</Row>
            {s.graceEndsAt && <Row label={k.graceEnds}>{date(s.graceEndsAt)}</Row>}
            {s.cancelAtPeriodEnd && <Row label={k.cancelAtEnd}>✓</Row>}
            {s.scheduledPlan && <Row label={k.scheduled}>{s.scheduledPlan}</Row>}
            <Row label={k.addons}>{interpolate(k.addonsValue, { seats: s.extraSeats, gb: s.extraStorageGb })}</Row>
            <Row label={k.paymentMethod}>{s.paymentMethod ? `${s.paymentMethod.brand} •••• ${s.paymentMethod.last4}` : k.none}</Row>
            <Row label={k.owner}>{d.ownerEmail ?? k.none}</Row>
            <Row label={k.created}>{date(d.createdAt)}</Row>
          </dl>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold">{k.usage}</h2>
          <dl className="mt-2 divide-y divide-border">
            <Row label={k.seats}>
              {d.seats.used} / {d.seats.limit}
            </Row>
            <Row label={k.storage}>
              {d.usage.storageMb.used} MB / {Math.round(d.usage.storageMb.limit / 1024)} GB
            </Row>
            <Row label={k.contacts}>{formatNumber(d.usage.contacts, locale)}</Row>
            <Row label={k.deals}>{formatNumber(d.usage.deals, locale)}</Row>
            <Row label={k.tasks}>{formatNumber(d.usage.tasks, locale)}</Row>
            <Row label={k.conversations}>{formatNumber(d.usage.conversations, locale)}</Row>
          </dl>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold">{k.actions}</h2>
          <TenantActions tenantId={d.id} name={d.name} status={d.status} canAct={me.role === "SUPER_ADMIN"} />
        </section>
      </div>

      <section className="card relative overflow-x-auto">
        <h2 className="px-5 pt-4 text-sm font-semibold">{k.members}</h2>
        <table className="mt-2 w-full min-w-[620px] text-sm">
          <tbody className="divide-y divide-border">
            {d.members.map((m) => (
              <tr key={m.id}>
                <td className="px-5 py-2">
                  <p className="font-medium">{m.fullName}</p>
                  <p className="text-xs text-fg-subtle">{m.email}</p>
                </td>
                <td className="px-3 text-xs">{t.shell.roles[m.role as keyof typeof t.shell.roles] ?? m.role}</td>
                <td className="px-3 text-xs text-fg-muted">{t.members.statuses[m.status as keyof typeof t.members.statuses] ?? m.status}</td>
                <td className="px-5 text-right text-xs text-fg-muted">
                  {k.lastLogin}: {m.lastLoginAt ? formatDateTime(m.lastLoginAt, locale) : k.never}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
        <section className="card relative overflow-x-auto">
          <h2 className="px-5 pt-4 text-sm font-semibold">{k.invoices}</h2>
          {d.invoices.length === 0 ? (
            <p className="px-5 py-4 text-sm text-fg-muted">{t.billing.noInvoices}</p>
          ) : (
            <table className="mt-2 w-full min-w-[440px] text-sm">
              <tbody className="divide-y divide-border">
                {d.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-5 py-2 font-mono text-xs">{inv.number}</td>
                    <td className="px-3 text-xs">{t.billing.invoiceKinds[inv.kind]}</td>
                    <td className="tabular px-3 text-right">{formatMoney(inv.amount, locale, inv.currency)}</td>
                    <td className="px-5 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${INVOICE_STATUS_STYLE[inv.status] ?? "bg-muted text-fg-muted"}`}>{t.billing.invoiceStatuses[inv.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2 className="px-5 pt-4 text-sm font-semibold">{k.activity}</h2>
          <ul className="mt-2 divide-y divide-border text-sm">
            {d.activity.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2">
                <span>
                  <span className="font-mono text-xs">{a.action}</span>
                  {a.actor && <span className="ml-2 text-xs text-fg-subtle">{a.actor}</span>}
                </span>
                <span className="shrink-0 text-xs text-fg-muted">{formatDateTime(a.createdAt, locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
