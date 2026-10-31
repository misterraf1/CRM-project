import type { PortalDto } from "@/shared";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PortalActions } from "@/components/growth/PortalActions";
import { apiPublic } from "@/lib/api/server";
import { formatDate, formatMoneyExact } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Portal", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ token: string }> };

/** The customer's portal: their documents, orders, requests and files (the link is the key). */
export default async function PortalPage({ params }: Props) {
  const { token } = await params;
  const [{ t, locale }, res] = await Promise.all([getI18n(), apiPublic<PortalDto>(`/v1/public/portal/${encodeURIComponent(token)}`)]);
  const k = t.portal;
  if (!res.ok) {
    return (
      <main className="grid min-h-screen place-items-center bg-muted/40 px-4">
        <p className="card max-w-md p-6 text-sm text-fg-muted">{k.notFound}</p>
      </main>
    );
  }
  const p = res.data;
  const docStatus = (status: string) => (t.sales.statuses as Record<string, string>)[status] ?? status;

  return (
    <main className="min-h-screen bg-muted/40 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex items-center gap-3">
          {p.company.logo && <img src={p.company.logo} alt="" className="h-10 w-auto max-w-32 object-contain" />}
          <div>
            <p className="text-xs text-fg-muted">
              {p.company.name} · {k.title}
            </p>
            <h1 className="text-xl font-semibold tracking-tight">{interpolate(k.welcome, { name: p.customer.name })}</h1>
          </div>
        </header>

        <Block title={k.docs} empty={k.empty} count={p.docs.length}>
          {p.docs.map((d) => (
            <li key={d.id}>
              <Link href={`/c/${token}/d/${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm hover:bg-muted">
                <span className="min-w-0 flex-1 font-medium">
                  {t.shell.search.kinds[d.kind]} {d.number ?? ""}
                </span>
                <span className="text-xs text-fg-muted">{formatDate(d.date, locale)}</span>
                <span className="tabular text-sm">{formatMoneyExact(d.total, locale, d.currency)}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-fg-muted">{docStatus(d.status)}</span>
              </Link>
            </li>
          ))}
        </Block>

        <Block title={k.orders} empty={k.empty} count={p.orders.length}>
          {p.orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
              <span className="font-mono text-xs text-fg-subtle">{o.number}</span>
              <span className="min-w-0 flex-1 font-medium">{o.title}</span>
              <span className="text-xs text-fg-muted">{interpolate(k.progress, { done: o.progress.done, total: o.progress.total })}</span>
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">{t.orders.statuses[o.status as keyof typeof t.orders.statuses] ?? o.status}</span>
            </li>
          ))}
        </Block>

        <Block title={k.cases} empty={k.empty} count={p.cases.length}>
          {p.cases.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
              <span className="font-mono text-xs text-fg-subtle">{c.number}</span>
              <span className="min-w-0 flex-1">{c.subject}</span>
              <span className="text-xs text-fg-muted">{t.cases.statuses[c.status]}</span>
            </li>
          ))}
        </Block>

        {p.files.length > 0 && (
          <Block title={k.files} empty={k.empty} count={p.files.length}>
            {p.files.map((f) => (
              <li key={f.id} className="flex justify-between gap-3 px-5 py-2 text-sm">
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-xs text-fg-muted">{formatDate(f.createdAt, locale)}</span>
              </li>
            ))}
          </Block>
        )}

        <PortalActions token={token} />
      </div>
    </main>
  );
}

function Block({ title, empty, count, children }: { title: string; empty: string; count: number; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">{title}</h2>
      {count ? <ul className="divide-y divide-border">{children}</ul> : <p className="px-5 py-4 text-sm text-fg-subtle">{empty}</p>}
    </section>
  );
}
