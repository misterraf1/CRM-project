import type { TodayDto } from "@/shared";
import clsx from "clsx";
import { AlertTriangle, ArrowRight, CalendarDays, CheckSquare, Headset, MessageSquareText, PhoneCall, Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";

/** One line of what today holds; each count opens where the work is. */
export function TodayStrip({ today, t }: { today: TodayDto; t: Dictionary }) {
  const k = t.dashboard.today;
  const chips: { n: number; label: string; href: string; icon: LucideIcon; tone: string }[] = [
    { n: today.events.length, label: k.events, href: "/calendar?view=day", icon: CalendarDays, tone: "text-accent" },
    { n: today.overdueTasks.length, label: k.overdue, href: "/tasks?view=overdue", icon: AlertTriangle, tone: "text-danger" },
    { n: today.todayTasks.length, label: k.tasks, href: "/today", icon: CheckSquare, tone: "text-success" },
    { n: today.conversations.length, label: k.chats, href: "/inbox", icon: MessageSquareText, tone: "text-warning" },
    { n: today.callbacks.length, label: k.callbacks, href: "/today", icon: PhoneCall, tone: "text-brand-teal" },
    { n: today.cases.length, label: k.cases, href: "/cases?f=mine", icon: Headset, tone: "text-brand-violet" },
  ].filter((c) => c.n > 0);

  return (
    <section aria-label={k.title} className="card flex flex-wrap items-center gap-2 px-4 py-3">
      <h2 className="mr-1 text-sm font-semibold">{k.title}</h2>
      {chips.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-fg-muted">
          <Sparkles className="h-4 w-4 text-success" aria-hidden />
          {k.allClear}
        </p>
      ) : (
        chips.map(({ n, label, href, icon: Icon, tone }) => (
          <Link key={label} href={href} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-sm transition-colors hover:border-accent/50 hover:bg-accent-soft">
            <Icon className={clsx("h-4 w-4", tone)} aria-hidden />
            <span className="tabular font-semibold">{n}</span>
            <span className="text-fg-muted">{label}</span>
          </Link>
        ))
      )}
      <Link href="/today" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
        {k.open}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </section>
  );
}
