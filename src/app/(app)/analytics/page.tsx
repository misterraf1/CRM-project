import clsx from "clsx";
import { Download, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ANALYTICS_PERIODS, type AnalyticsPeriod } from "@/shared";
import { BarList } from "@/components/analytics/BarList";
import { planGate } from "@/components/billing/UpgradeGate";
import { StatTile } from "@/components/ui/StatTile";
import { getAnalyticsAdvanced, getAnalyticsBasic, getSession } from "@/lib/api";
import { hasFeature } from "@/lib/billing";
import { formatLocalMonth, formatMoney, formatNumber } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Analytics" };

type Props = { searchParams: Promise<{ period?: string }> };

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export default async function AnalyticsPage({ searchParams }: Props) {
  const gate = await planGate("analytics.basic");
  if (gate) return gate;
  const [{ t, locale }, me, sp] = await Promise.all([getI18n(), getSession(), searchParams]);
  const k = t.analytics;
  if (!me.permissions.includes("analytics.view")) return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;

  const period = (ANALYTICS_PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as AnalyticsPeriod) : "90d";
  const advancedOn = hasFeature(me, "analytics.advanced");
  const [a, adv] = await Promise.all([getAnalyticsBasic(period), advancedOn ? getAnalyticsAdvanced(period) : null]);
  const money = (v: number) => formatMoney(v, locale, a.currency);
  const s = a.sales;
  const days = (v: number | null) => (v === null ? "—" : interpolate(k.days, { n: formatNumber(v, locale, 1) }));
  const mins = (v: number | null) => (v === null ? "—" : interpolate(k.minutes, { n: v }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {k.subtitle} · {k.scopes[a.scope]}
          </p>
        </div>
        <nav className="flex rounded-lg bg-muted p-0.5 text-xs font-medium" aria-label={k.title}>
          {ANALYTICS_PERIODS.map((p) => (
            <Link
              key={p}
              href={`/analytics?period=${p}`}
              aria-current={p === period ? "page" : undefined}
              className={clsx("rounded-md px-3 py-1.5", p === period ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
            >
              {k.periods[p]}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatTile label={k.dealsCreated} value={formatNumber(s.created, locale)} hint={interpolate(k.outcome, { won: s.won, lost: s.lost, open: s.stillOpen })} />
        <StatTile label={k.winRate} value={pct(s.winRate)} hint={k.winRateHint} />
        <StatTile label={k.wonAmount} value={money(s.wonAmount)} />
        <StatTile label={k.avgDealSize} value={s.avgDealSize === null ? "—" : money(s.avgDealSize)} />
        <StatTile label={k.avgCycle} value={days(s.avgCycleDays)} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-semibold">{k.funnel}</h2>
          <p className="mb-3 mt-0.5 text-[11px] text-fg-subtle">{k.funnelHint}</p>
          <BarList
            empty={k.empty}
            rows={a.funnel.map((f) => ({
              key: f.stageId,
              label: f.name,
              value: f.deals,
              display: formatNumber(f.deals, locale),
              hint: money(f.amount),
              tone: f.kind === "won" ? "success" : f.kind === "lost" ? "danger" : "series",
            }))}
          />
        </section>
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold">{k.lostReasons}</h2>
          <BarList
            empty={k.empty}
            rows={a.lostReasons.map((r) => ({ key: r.reason || "-", label: r.reason || k.noReason, value: r.deals, display: formatNumber(r.deals, locale), hint: money(r.amount) }))}
          />
        </section>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="card relative overflow-x-auto">
          <h2 className="px-5 pt-4 text-sm font-semibold">{k.sources}</h2>
          {a.sources.length === 0 ? (
            <p className="px-5 py-4 text-sm text-fg-muted">{k.empty}</p>
          ) : (
            <table className="mt-2 w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-fg-subtle">
                  <th scope="col" className="px-5 py-2 font-medium">{k.source}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{k.contacts}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{k.customers}</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">{k.wonDeals}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {a.sources.map((r) => (
                  <tr key={r.source || "-"}>
                    <td className="px-5 py-2">{t.crm.sources[r.source as keyof typeof t.crm.sources] ?? (r.source || "—")}</td>
                    <td className="tabular px-3 text-right">{r.contacts}</td>
                    <td className="tabular px-3 text-right">
                      {r.customers} <span className="text-xs text-fg-subtle">({pct(r.contacts ? r.customers / r.contacts : null)})</span>
                    </td>
                    <td className="tabular px-5 text-right">
                      {r.wonDeals} · {money(r.wonAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="text-sm font-semibold">{k.inbox}</h2>
            {a.inbox.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">{k.empty}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border text-sm">
                {a.inbox.map((c) => (
                  <li key={c.channel} className="flex items-center justify-between gap-3 py-2">
                    <span>{t.channels.types[c.channel]}</span>
                    <span className="tabular text-right text-xs text-fg-muted">
                      <span className="text-sm font-medium text-fg">{c.conversations}</span> · {k.firstResponse}: {mins(c.avgFirstResponseMin)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card p-5">
            <h2 className="text-sm font-semibold">{k.tasks}</h2>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-fg-muted">{k.tasksCreated}</dt>
                <dd className="tabular text-lg font-semibold">{a.tasks.created}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">{k.tasksCompleted}</dt>
                <dd className="tabular text-lg font-semibold">{a.tasks.completed}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">{k.onTime}</dt>
                <dd className="tabular text-lg font-semibold">{pct(a.tasks.completed ? a.tasks.completedOnTime / a.tasks.completed : null)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">{k.overdueOpen}</dt>
                <dd className={clsx("tabular text-lg font-semibold", a.tasks.overdueOpen && "text-danger")}>{a.tasks.overdueOpen}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <h2 className="pt-2 text-base font-semibold">{k.advanced}</h2>
      {!adv ? (
        <div className="card flex flex-wrap items-center gap-3 p-5 text-sm">
          <Lock className="h-4 w-4 text-fg-subtle" aria-hidden />
          <span className="flex-1 text-fg-muted">{k.advancedLocked}</span>
          {me.permissions.includes("billing.manage") && (
            <Link href="/settings/billing" className="btn-primary h-8 text-xs">
              {t.billing.seePlans}
            </Link>
          )}
        </div>
      ) : (
        <>
          <section className="card relative overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
              <h3 className="text-sm font-semibold">{k.members}</h3>
              {me.permissions.includes("deals.export") && (
                <a href={`/api/v1/analytics/export/deals.csv?period=${period}`} download className="btn-ghost h-8 border border-border text-xs">
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  {k.export}
                </a>
              )}
            </div>
            <table className="mt-2 w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-fg-subtle">
                  <th scope="col" className="px-5 py-2 font-medium">{k.member}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{k.dealsCreated}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{k.won} / {k.lost}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{k.winRate}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{k.revenue}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{k.cycle}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{k.tasksDone} · {k.onTime}</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">{k.responses}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {adv.members.map((m) => (
                  <tr key={m.member.id}>
                    <td className="px-5 py-2">
                      <p className="font-medium">{m.member.name}</p>
                      {m.member.title && <p className="text-xs text-fg-subtle">{m.member.title}</p>}
                    </td>
                    <td className="tabular px-3 text-right">{m.dealsCreated}</td>
                    <td className="tabular px-3 text-right">
                      {m.dealsWon} / {m.dealsLost}
                    </td>
                    <td className="tabular px-3 text-right">{pct(m.winRate)}</td>
                    <td className="tabular px-3 text-right font-medium">{money(m.revenue)}</td>
                    <td className="tabular px-3 text-right">{days(m.avgCycleDays)}</td>
                    <td className="tabular px-3 text-right">
                      {m.tasksDone} · {pct(m.onTimeRate)}
                    </td>
                    <td className="tabular px-5 text-right">
                      {m.conversations} · {mins(m.avgFirstResponseMin)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card p-5">
            <h3 className="mb-3 text-sm font-semibold">
              {k.trend} · {k.revenue}
            </h3>
            <BarList
              empty={k.empty}
              rows={adv.months.map((m) => ({
                key: m.month,
                label: formatLocalMonth(m.month, locale),
                value: m.revenue,
                display: money(m.revenue),
                hint: `${k.dealsWon}: ${m.dealsWon} · ${k.newContacts}: ${m.newContacts}`,
              }))}
            />
          </section>
        </>
      )}
    </div>
  );
}
