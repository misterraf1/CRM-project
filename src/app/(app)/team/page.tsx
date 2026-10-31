import clsx from "clsx";
import { Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { getSession, getTeamStats, parsePeriod } from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { planGate } from "@/components/billing/UpgradeGate";

export const metadata: Metadata = { title: "Team" };

type Props = { searchParams: Promise<{ period?: string }> };

export default async function TeamPage({ searchParams }: Props) {
  const gate = await planGate("team.monitoring");
  if (gate) return gate;
  const period = parsePeriod((await searchParams).period);
  const [{ t, locale }, me, stats] = await Promise.all([getI18n(), getSession(), getTeamStats(period)]);
  const k = t.team;
  const canManage = me.permissions.includes("members.manage") || me.permissions.includes("members.invite");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {k.subtitle}
            {!me.permissions.includes("dashboard.view_all") && ` · ${k.scopeHint}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <nav aria-label={t.dashboard.periodLabel} className="flex rounded-lg border border-border bg-surface p-0.5">
            {(["7d", "30d", "90d"] as const).map((p) => (
              <Link
                key={p}
                href={`?period=${p}`}
                aria-current={p === period ? "true" : undefined}
                className={clsx("rounded-md px-3 py-1.5 text-xs font-medium", p === period ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-muted")}
              >
                {t.dashboard.period[p]}
              </Link>
            ))}
          </nav>
          {canManage && (
            <Link href="/settings/members" className="btn-ghost h-8 text-xs">
              <Settings className="h-3.5 w-3.5" aria-hidden />
              {k.manage}
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.member.id} href={`/team/${s.member.id}`} className="card block p-4 transition-colors hover:border-accent/40">
            <div className="flex items-center gap-3">
              <Avatar name={s.member.name} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{s.member.name}</p>
                <p className="truncate text-xs text-fg-subtle">{s.member.title ?? t.shell.roles[s.member.role as keyof typeof t.shell.roles]}</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                [k.openTasks, formatNumber(s.openTasks, locale), ""],
                [k.overdue, formatNumber(s.overdueTasks, locale), s.overdueTasks ? "text-danger" : ""],
                [k.done, formatNumber(s.tasksDone, locale), ""],
                [k.dealsWon, formatNumber(s.dealsWon, locale), ""],
                [k.revenue, formatMoney(s.revenue, locale, me.tenant.currency, true), ""],
                [k.openDeals, formatNumber(s.openDeals, locale), ""],
              ].map(([label, value, tone]) => (
                <div key={label} className="rounded-lg bg-muted/50 px-1 py-2">
                  <dt className="truncate text-[11px] text-fg-subtle">{label}</dt>
                  <dd className={clsx("tabular mt-0.5 text-sm font-semibold", tone)}>{value}</dd>
                </div>
              ))}
            </dl>
          </Link>
        ))}
      </div>
    </div>
  );
}
