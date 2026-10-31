import type { CalendarEventDto, CalendarTaskDto, ChannelType } from "@/shared";
import clsx from "clsx";
import { AlertTriangle, CalendarDays, CheckSquare, Handshake, Headset, MessageSquareText, PhoneCall } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { getToday } from "@/lib/api";
import { dayKey, timeOf } from "@/lib/calendar";
import { formatDate, formatDateTime, formatDuration, formatMoneyExact } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/locales";

export const metadata: Metadata = { title: "Today" };

/** One screen for the working day: meetings, deadlines, waiting customers, deals to close. */
export default async function TodayPage() {
  const [{ t, locale }, d] = await Promise.all([getI18n(), getToday()]);
  const k = t.today;
  const now = new Date();
  const empty = !d.events.length && !d.overdueTasks.length && !d.todayTasks.length && !d.conversations.length && !d.deals.length && !d.callbacks.length && !d.cases.length;
  const todayKey = dayKey(now.toISOString());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {formatDate(now.toISOString(), locale, "long")} · {k.subtitle}
          </p>
        </div>
        <Link href={`/calendar?view=day&date=${todayKey}`} className="btn-ghost border border-border">
          <CalendarDays className="h-4 w-4" aria-hidden />
          {k.openCalendar}
        </Link>
      </div>

      {empty && <p className="card px-5 py-10 text-center text-sm text-fg-muted">{k.allClear}</p>}

      {(() => {
        const sections = [
          { key: "events", n: d.events.length, title: k.events, node: (
        <Section key="events" title={k.events} icon={<CalendarDays className="h-4 w-4 text-accent" />} count={d.events.length} empty={k.none}>
          {d.events.map((ev) => (
            <EventRow key={`${ev.id}${ev.startAt}`} ev={ev} label={ev.allDay ? k.allDay : `${timeOf(ev.startAt)}–${timeOf(ev.endAt)}`} kind={t.calendar.kinds[ev.kind]} />
          ))}
        </Section>) },
          { key: "overdue", n: d.overdueTasks.length, title: k.overdue, node: (
        <Section key="overdue" title={k.overdue} icon={<AlertTriangle className="h-4 w-4 text-danger" />} count={d.overdueTasks.length} empty={k.none} tone="danger">
          {d.overdueTasks.map((task) => (
            <TaskRow key={task.id} task={task} when={formatDateTime(task.dueAt, locale)} late />
          ))}
        </Section>) },
          { key: "tasks", n: d.todayTasks.length, title: k.tasks, node: (
        <Section key="tasks" title={k.tasks} icon={<CheckSquare className="h-4 w-4 text-accent" />} count={d.todayTasks.length} empty={k.none}>
          {d.todayTasks.map((task) => (
            <TaskRow key={task.id} task={task} when={timeOf(task.dueAt)} />
          ))}
        </Section>) },
          { key: "conversations", n: d.conversations.length, title: k.conversations, node: (
        <Section key="conversations" title={k.conversations} icon={<MessageSquareText className="h-4 w-4 text-warning" />} count={d.conversations.length} empty={k.none}>
          {d.conversations.map((c) => (
            <li key={c.id}>
              <Link href={`/inbox?c=${c.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted">
                {c.channel && <ChannelIcon channel={c.channel as ChannelType} label={t.channels.types[c.channel as ChannelType] ?? c.channel} size="sm" />}
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                {c.slaBreached && <span className="rounded-full bg-danger/10 px-1.5 text-[11px] font-semibold text-danger">{k.sla}</span>}
                <span className={clsx("shrink-0 text-xs", c.slaBreached ? "text-danger" : "text-fg-subtle")}>
                  {interpolate(k.waiting, { time: formatDuration((now.getTime() - new Date(c.waitingSince).getTime()) / 60_000, locale) })}
                </span>
              </Link>
            </li>
          ))}
        </Section>) },
          { key: "callbacks", n: d.callbacks.length, title: k.callbacks, node: (
        <Section key="callbacks" title={k.callbacks} icon={<PhoneCall className="h-4 w-4 text-success" />} count={d.callbacks.length} empty={k.none}>
          {d.callbacks.map((ev) => (
            <EventRow key={ev.id} ev={ev} label={formatDate(ev.startAt, locale)} kind={t.calendar.outcomes.callback} />
          ))}
        </Section>) },
          { key: "cases", n: d.cases.length, title: k.cases, node: (
        <Section key="cases" title={k.cases} icon={<Headset className="h-4 w-4 text-warning" />} count={d.cases.length} empty={k.none}>
          {d.cases.map((c) => (
            <li key={c.id}>
              <Link href={`/cases/${c.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted">
                <span className="tabular w-24 shrink-0 text-xs text-fg-subtle">{c.number}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.subject}</span>
                <span className={clsx("shrink-0 text-xs", c.overdue ? "text-danger" : "text-fg-subtle")}>{formatDateTime(c.dueAt, locale)}</span>
              </Link>
            </li>
          ))}
        </Section>) },
          { key: "deals", n: d.deals.length, title: k.deals, node: (
        <Section key="deals" title={k.deals} icon={<Handshake className="h-4 w-4 text-accent" />} count={d.deals.length} empty={k.none}>
          {d.deals.map((deal) => {
            const late = !!deal.expectedClose && new Date(deal.expectedClose) < now;
            return (
              <li key={deal.id}>
                <Link href={`/deals/${deal.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted">
                  <span className="min-w-0 flex-1 truncate font-medium">{deal.title}</span>
                  <span className="tabular shrink-0 text-xs text-fg-muted">{formatMoneyExact(deal.amount, locale, deal.currency)}</span>
                  {deal.expectedClose && <span className={clsx("shrink-0 text-xs", late ? "text-danger" : "text-fg-subtle")}>{formatDate(deal.expectedClose, locale)}</span>}
                </Link>
              </li>
            );
          })}
        </Section>) },
        ];
        const quiet = sections.filter((x) => !x.n);
        return (
          <>
            <div className="grid gap-4 lg:grid-cols-2">{sections.filter((x) => x.n).map((x) => x.node)}</div>
            {/* Nothing waiting there: one compact line each instead of empty cards */}
            {!empty && quiet.length > 0 && (
              <section className="card px-5 py-3" aria-label={k.none}>
                <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-subtle">
                  {quiet.map((x) => (
                    <li key={x.key}>
                      {x.title} · 0
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        );
      })()}
    </div>
  );
}

function Section({ title, icon, count, empty, tone, children }: { title: string; icon: ReactNode; count: number; empty: string; tone?: "danger"; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <header className="flex items-center gap-2 border-b border-border px-5 py-3">
        <span aria-hidden>{icon}</span>
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        <span className={clsx("tabular rounded-full px-2 text-xs font-semibold", count && tone === "danger" ? "bg-danger/10 text-danger" : "bg-muted text-fg-muted")}>{count}</span>
      </header>
      {count ? <ul className="divide-y divide-border">{children}</ul> : <p className="px-5 py-4 text-sm text-fg-subtle">{empty}</p>}
    </section>
  );
}

function EventRow({ ev, label, kind }: { ev: CalendarEventDto; label: string; kind: string }) {
  return (
    <li>
      <Link href={`/calendar?view=day&date=${dayKey(ev.startAt)}&event=${ev.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted">
        <span className="tabular w-24 shrink-0 text-xs text-fg-muted">{label}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{ev.title}</span>
          {/* A logged call is titled after the customer: show its note instead */}
          {(ev.contact && ev.contact.name !== ev.title ? ev.contact.name : ev.outcomeNote) && (
            <span className="block truncate text-xs text-fg-muted">{ev.contact && ev.contact.name !== ev.title ? ev.contact.name : ev.outcomeNote}</span>
          )}
        </span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-fg-muted">{kind}</span>
      </Link>
    </li>
  );
}

function TaskRow({ task, when, late }: { task: CalendarTaskDto; when: string; late?: boolean }) {
  return (
    <li>
      <Link href={`/tasks/${task.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted">
        <span className={clsx("tabular w-24 shrink-0 text-xs", late ? "text-danger" : "text-fg-muted")}>{when}</span>
        <span className={clsx("min-w-0 flex-1 truncate font-medium", task.status === "DONE" && "text-fg-subtle line-through")}>{task.title}</span>
      </Link>
    </li>
  );
}
