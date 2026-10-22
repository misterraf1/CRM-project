import clsx from "clsx";
import type { DashboardCrmDto } from "@axis/shared";
import { ArrowDownRight, ArrowUpRight, CheckSquare, Handshake, MessageSquareText, UserPlus, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { formatDuration, formatMoney, formatNumber, percentChange } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { interpolate, type Locale } from "@/lib/i18n/locales";

interface Kpi {
  label: string;
  value: string;
  href: string;
  icon: LucideIcon;
  delta?: number | null;
  hint?: string;
  tone?: "default" | "warning" | "danger";
}

function Delta({ value, label }: { value: number; label: string }) {
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span title={label} className={clsx("inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-success" : "text-danger")}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {Math.abs(value)}%<span className="sr-only"> {label}</span>
    </span>
  );
}

const delta = (c: { value: number; previous: number | null }) => (c.previous === null ? null : percentChange(c.value, c.previous));

export function KpiGrid({ crm, t, locale }: { crm: DashboardCrmDto; t: Dictionary; locale: Locale }) {
  const k = t.dashboard.kpi;
  const { kpis, currency } = crm;
  const items: Kpi[] = [
    { label: k.newContacts, value: formatNumber(kpis.newContacts.value, locale), href: "/crm", icon: UserPlus, delta: delta(kpis.newContacts) },
    {
      label: k.activeDeals,
      value: formatNumber(kpis.activeDeals.value, locale),
      href: "/deals",
      icon: Handshake,
      hint: interpolate(k.activeDealsHint, { amount: formatMoney(kpis.activeDeals.pipelineValue, locale, currency, true) }),
    },
    { label: k.revenue, value: formatMoney(kpis.revenue.value, locale, currency), href: "/deals", icon: Wallet, delta: delta(kpis.revenue) },
    {
      label: k.awaiting,
      value: formatNumber(crm.inbox.awaiting, locale),
      href: "/inbox",
      icon: MessageSquareText,
      tone: (crm.inbox.longestWaitMin ?? 0) > 60 ? "warning" : "default",
      hint: crm.inbox.longestWaitMin !== null ? interpolate(k.awaitingHint, { time: formatDuration(crm.inbox.longestWaitMin, locale) }) : undefined,
    },
    {
      label: k.openTasks,
      value: formatNumber(crm.tasks.open, locale),
      href: "/tasks",
      icon: CheckSquare,
      tone: crm.tasks.overdue > 0 ? "danger" : "default",
      hint: crm.tasks.overdue ? interpolate(k.openTasksHint, { n: crm.tasks.overdue }) : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {items.map((item, i) => (
        <Link
          key={item.label}
          href={item.href}
          className={clsx("card group min-w-0 p-4 transition-colors hover:border-accent/40", i === 2 && "col-span-2 md:col-span-1")}
        >
          <div className="flex items-center justify-between gap-2 text-fg-subtle">
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-muted">
              <span className="truncate">{item.label}</span>
            </span>
            <item.icon className="h-4 w-4 shrink-0 group-hover:text-accent" aria-hidden />
          </div>
          <p className="tabular mt-2 truncate text-2xl font-semibold tracking-tight">{item.value}</p>
          <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-2 text-xs">
            {item.delta != null && <Delta value={item.delta} label={t.dashboard.vsPrevious} />}
            {item.hint && (
              <span className={clsx(item.tone === "danger" ? "text-danger" : item.tone === "warning" ? "text-warning" : "text-fg-subtle")}>
                {item.hint}
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
