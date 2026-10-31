import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Timeline } from "@/components/crm/Timeline";
import { TaskList } from "@/components/tasks/TaskList";
import { Avatar } from "@/components/ui/Avatar";
import { getMemberProfile, getSession } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";
import { planGate } from "@/components/billing/UpgradeGate";

export const metadata: Metadata = { title: "Team" };

type Props = { params: Promise<{ id: string }> };

export default async function MemberProfilePage({ params }: Props) {
  const gate = await planGate("team.monitoring");
  if (gate) return gate;
  const { id } = await params;
  const profile = await getMemberProfile(id).catch((e) => {
    if (e instanceof ApiRequestError && e.status === 404) notFound();
    throw e;
  });
  const [{ t, locale }, me] = await Promise.all([getI18n(), getSession()]);
  const k = t.team;
  const stats = [
    [k.openTasks, formatNumber(profile.openTasks, locale)],
    [k.overdue, formatNumber(profile.overdueTasks, locale)],
    [k.done, formatNumber(profile.tasksDone, locale)],
    [k.dealsWon, formatNumber(profile.dealsWon, locale)],
    [k.revenue, formatMoney(profile.revenue, locale, me.tenant.currency)],
    [k.openDeals, formatNumber(profile.openDeals, locale)],
  ];

  return (
    <div className="space-y-5">
      <Link href="/team" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {k.back}
      </Link>
      <div className="flex items-center gap-4">
        <Avatar name={profile.member.name} />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{profile.member.name}</h1>
          <p className="text-sm text-fg-muted">
            {[profile.member.title, t.shell.roles[profile.member.role as keyof typeof t.shell.roles], profile.department ?? k.noDepartment, profile.member.email]
              .filter(Boolean)
              .join(" · ")}
            {profile.joinedAt && ` · ${interpolate(k.joined, { date: formatDate(profile.joinedAt, locale, "long") })}`}
          </p>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs text-fg-subtle">{interpolate(k.period, { period: t.dashboard.period["30d"] })}</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map(([label, value]) => (
            <div key={label} className="card p-4">
              <dt className="text-xs text-fg-muted">{label}</dt>
              <dd className="tabular mt-1 text-xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card min-w-0">
          <h2 className="px-5 pt-4 text-sm font-semibold">{k.currentTasks}</h2>
          <div className="mt-2 border-t border-border">
            <TaskList tasks={profile.tasks} compact />
          </div>
        </section>
        <section className="card min-w-0">
          <h2 className="px-5 pt-4 text-sm font-semibold">{k.recentActivity}</h2>
          <div className="mt-2 border-t border-border">
            <Timeline items={profile.activity} t={t} locale={locale} />
          </div>
        </section>
      </div>
    </div>
  );
}
