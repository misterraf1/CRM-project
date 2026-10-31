import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AskAi } from "@/components/ai/AskAi";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { AttentionList } from "@/components/dashboard/AttentionList";
import { AwaitingInbox } from "@/components/dashboard/AwaitingInbox";
import { DashboardCustomizer } from "@/components/dashboard/DashboardCustomizer";
import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { OverdueTasks } from "@/components/dashboard/OverdueTasks";
import { PaymentsCard } from "@/components/dashboard/PaymentsCard";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import { PipelineSnapshot } from "@/components/dashboard/PipelineSnapshot";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { TargetCard } from "@/components/dashboard/TargetCard";
import { TeamPerformance } from "@/components/dashboard/TeamPerformance";
import { TodayStrip } from "@/components/dashboard/TodayStrip";
import { WorkQueue } from "@/components/dashboard/WorkQueue";
import { OnboardingCard } from "@/components/onboarding/OnboardingCard";
import { CardHeader } from "@/components/ui/Card";
import { getAttention, getDashboard, getOnboarding, getSession, getTargets, getToday, parsePeriod } from "@/lib/api";
import { DASHBOARD_COOKIE, DASHBOARD_WIDGETS, hiddenWidgets, type DashboardWidget } from "@/lib/dashboard";
import { formatDate } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Dashboard" };

type Props = { searchParams: Promise<{ period?: string | string[] }> };

/**
 * Three zones, top to bottom: what to do now (quick actions, today, needs attention),
 * how the business is doing, and the team. Each member hides what they don't use.
 */
export default async function DashboardPage({ searchParams }: Props) {
  const period = parsePeriod((await searchParams).period);
  const [{ t, locale }, session, jar] = await Promise.all([getI18n(), getSession(), cookies()]);
  const hidden = new Set(hiddenWidgets(jar.get(DASHBOARD_COOKIE)?.value));
  const show = (w: DashboardWidget) => !hidden.has(w);
  const [data, attention, targets, onboarding, today] = await Promise.all([
    getDashboard(period),
    show("attention") ? getAttention() : [],
    show("targets") ? getTargets("month") : null,
    getOnboarding(),
    show("today") ? getToday() : null,
  ]);
  const now = new Date(data.generatedAt);
  const firstName = session.user.fullName.split(" ")[0] ?? session.user.fullName;
  const r = t.dashboard.revenue;
  const q = t.dashboard.queue;
  // Only blocks this member can actually see are offered in Customise
  const available = DASHBOARD_WIDGETS.filter((w) => (w === "ai" ? session.ai.available : w === "onboarding" ? !onboarding.dismissed : true));

  const queue = [
    { key: "chats", label: q.chats, count: data.inbox.awaiting, node: <AwaitingInbox inbox={data.inbox} now={now} t={t} locale={locale} /> },
    { key: "tasks", label: q.tasks, count: data.tasks.overdue, node: <OverdueTasks tasks={data.tasks.overdueItems} now={now} t={t} locale={locale} /> },
    ...(data.payments ? [{ key: "payments", label: q.payments, count: data.payments.overdueCount, node: <PaymentsCard payments={data.payments} currency={data.currency} t={t} locale={locale} /> }] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{formatDate(now.toISOString(), locale, "long")}</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">{interpolate(t.dashboard.greeting, { name: firstName })}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">{interpolate(t.dashboard.subtitle, { company: session.tenant.name })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodFilter value={period} t={t} />
          <DashboardCustomizer hidden={[...hidden]} available={available} />
        </div>
      </div>

      {show("onboarding") && <OnboardingCard initial={onboarding} canManage={session.permissions.includes("crm.configure")} />}
      {show("quick") && <QuickActions permissions={session.permissions} t={t} />}
      {today && <TodayStrip today={today} t={t} />}

      {show("kpis") && <KpiGrid crm={data} t={t} locale={locale} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          {show("revenue") && (
            <section className="card">
              <CardHeader title={r.title} meta={interpolate(r.subtitle, { unit: data.revenue.bucket === "week" ? r.unitWeek : r.unitDay })} />
              <RevenueChart revenue={data.revenue} currency={data.currency} />
            </section>
          )}
          {show("pipeline") && data.pipeline && <PipelineSnapshot pipeline={data.pipeline} currency={data.currency} t={t} locale={locale} />}
          {show("team") && <TeamPerformance rows={data.team} currency={data.currency} canViewTeam={session.permissions.includes("members.view")} />}
        </div>
        {/* Phones: what needs doing comes before the charts */}
        <div className="order-first min-w-0 space-y-5 lg:order-none">
          {show("ai") && session.ai.available && <AskAi />}
          {show("attention") && <AttentionList items={attention} t={t} locale={locale} />}
          {show("queue") && <WorkQueue panels={queue} />}
          {targets && <TargetCard data={targets} meId={session.membership.id} t={t} locale={locale} />}
          {show("activity") && <ActivityFeed items={data.activity} now={now} t={t} locale={locale} />}
        </div>
      </div>
    </div>
  );
}
