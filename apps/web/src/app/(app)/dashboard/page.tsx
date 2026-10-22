import type { Metadata } from "next";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { AwaitingInbox } from "@/components/dashboard/AwaitingInbox";
import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { OverdueTasks } from "@/components/dashboard/OverdueTasks";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { TeamPerformance } from "@/components/dashboard/TeamPerformance";
import { CardHeader } from "@/components/ui/Card";
import { getDashboard, getSession, parsePeriod } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/locales";

export const metadata: Metadata = { title: "Dashboard" };

type Props = { searchParams: Promise<{ period?: string | string[] }> };

export default async function DashboardPage({ searchParams }: Props) {
  const period = parsePeriod((await searchParams).period);
  const [{ t, locale }, session, data] = await Promise.all([getI18n(), getSession(), getDashboard(period)]);
  const now = new Date(data.generatedAt);
  const firstName = session.user.fullName.split(" ")[0] ?? session.user.fullName;
  const r = t.dashboard.revenue;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{interpolate(t.dashboard.greeting, { name: firstName })}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">{interpolate(t.dashboard.subtitle, { company: session.tenant.name })}</p>
        </div>
        <PeriodFilter value={period} t={t} />
      </div>

      <KpiGrid kpis={data.kpis} t={t} locale={locale} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <section className="card">
            <CardHeader title={r.title} meta={interpolate(r.subtitle, { unit: data.revenue.bucket === "week" ? r.unitWeek : r.unitDay })} />
            <RevenueChart revenue={data.revenue} />
          </section>
          <TeamPerformance rows={data.team} />
        </div>
        <div className="min-w-0 space-y-5">
          <AwaitingInbox inbox={data.inbox} now={now} t={t} locale={locale} />
          <OverdueTasks tasks={data.overdueTasks} now={now} t={t} locale={locale} />
          <ActivityFeed items={data.activity} now={now} t={t} locale={locale} />
        </div>
      </div>
    </div>
  );
}
