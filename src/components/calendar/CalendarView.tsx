"use client";

import type { CalendarEventDto, CalendarTaskDto, MemberDto } from "@/shared";
import clsx from "clsx";
import { CheckSquare, ChevronLeft, ChevronRight, MapPin, Phone, Plus, Repeat, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { addDaysKey, dayKey, dayStart, shift, timeOf, weekday, type CalendarView as View } from "@/lib/calendar";
import { formatDate, formatLocalMonth, fromDateTimeInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { interpolate } from "@/lib/i18n/locales";
import { EventDialog, type EventDraft } from "./EventDialog";

interface Props {
  view: View;
  date: string;
  today: string;
  days: string[];
  member: string;
  events: CalendarEventDto[];
  tasks: CalendarTaskDto[];
  members: MemberDto[];
  meId: string;
  canAssign: boolean;
  /** Members whose calendars the caller may open (besides their own) */
  canSeeOthers: boolean;
  openEventId?: string;
  newDraft?: EventDraft;
}

const HOUR_PX = 48;
const KIND_STYLE: Record<string, string> = {
  meeting: "border-accent/40 bg-accent-soft text-accent",
  call: "border-success/40 bg-success/10 text-success",
  other: "border-border bg-muted text-fg",
};

type Item = { kind: "event"; ev: CalendarEventDto } | { kind: "task"; task: CalendarTaskDto };

/** Team calendar: month grid, week/day time grid (an agenda list on phones). */
export function CalendarView(props: Props) {
  const { view, date, today, days, member, tasks, members, meId, canAssign, canSeeOthers } = props;
  // The API's answer applies at once (a refresh right after load can be dropped); server data wins on refresh
  const [events, setEvents] = useState(props.events);
  useEffect(() => setEvents(props.events), [props.events]);
  const { t, locale } = useI18n();
  const k = t.calendar;
  const router = useRouter();
  const [dialog, setDialog] = useState<{ event: CalendarEventDto | null; draft: EventDraft } | null>(props.newDraft ? { event: null, draft: props.newDraft } : null);

  // Opened from a notification: the event may lie outside the loaded range
  useEffect(() => {
    if (!props.openEventId) return;
    const found = events.find((e) => e.id === props.openEventId);
    if (found) setDialog({ event: found, draft: found });
    else void api<CalendarEventDto>(`/calendar/events/${props.openEventId}`).then((r) => r.ok && setDialog({ event: r.data, draft: r.data }));
    // Once, for the id in the address
  }, [props.openEventId]);

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    const push = (key: string, item: Item) => map.set(key, [...(map.get(key) ?? []), item]);
    for (const ev of events) {
      // Multi-day events appear on every day they cover
      for (let d = dayKey(ev.startAt), last = dayKey(new Date(new Date(ev.endAt).getTime() - 1).toISOString()); d <= last && d <= days[days.length - 1]!; d = addDaysKey(d, 1)) {
        if (d >= days[0]!) push(d, { kind: "event", ev });
        if (!ev.allDay && d === dayKey(ev.startAt)) break;
      }
    }
    for (const task of tasks) push(dayKey(task.dueAt), { kind: "task", task });
    return map;
  }, [events, tasks, days]);

  const href = (patch: Partial<{ view: View; date: string; member: string }>) => {
    const p = new URLSearchParams({ view, date, member, ...patch });
    if (p.get("member") === "mine") p.delete("member");
    return `/calendar?${p}`;
  };

  const newAt = (key: string, hour = 10) => {
    const start = fromDateTimeInput(`${key}T${String(hour).padStart(2, "0")}:00`)!;
    setDialog({ event: null, draft: { startAt: start, endAt: new Date(new Date(start).getTime() + 3_600_000).toISOString() } });
  };
  const open = (ev: CalendarEventDto) => setDialog({ event: ev, draft: ev });

  const label =
    view === "month"
      ? formatLocalMonth(dayStart(date), locale)
      : view === "week"
        ? `${formatDate(dayStart(days[0]!), locale)} – ${formatDate(dayStart(days[6]!), locale)}`
        : `${k.weekdays[weekday(date)]}, ${formatDate(dayStart(date), locale, "long")}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
        </div>
        <button type="button" onClick={() => newAt(date >= today ? date : today, 10)} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden />
          {k.newEvent}
        </button>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-2">
        <Link href={href({ date: today })} className="btn-ghost border border-border">
          {k.today}
        </Link>
        <div className="flex">
          <Link href={href({ date: shift(view, date, -1) })} aria-label={k.prev} className="grid h-9 w-9 place-items-center rounded-lg text-fg-muted hover:bg-muted hover:text-fg">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link href={href({ date: shift(view, date, 1) })} aria-label={k.next} className="grid h-9 w-9 place-items-center rounded-lg text-fg-muted hover:bg-muted hover:text-fg">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        {/* On phones the period gets its own line instead of being cut off */}
        <h2 className="order-first w-full truncate text-base font-semibold capitalize sm:order-none sm:w-auto sm:min-w-0 sm:flex-1" aria-live="polite">
          {label}
        </h2>
        {canSeeOthers && (
          <label className="flex items-center gap-1.5 text-sm">
            <Users className="h-4 w-4 text-fg-subtle" aria-hidden />
            <span className="sr-only">{k.whose}</span>
            <select value={member} onChange={(e) => router.push(href({ member: e.target.value }))} className="input h-9 w-auto py-0">
              <option value="mine">{k.mine}</option>
              <option value="all">{k.all}</option>
              {members
                .filter((m) => m.status === "ACTIVE" && m.id !== meId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
            </select>
          </label>
        )}
        <nav aria-label={k.title} className="flex rounded-lg bg-muted p-0.5">
          {(["day", "week", "month"] as const).map((v) => (
            <Link
              key={v}
              href={href({ view: v })}
              aria-current={view === v ? "page" : undefined}
              className={clsx("rounded-md px-3 py-1.5 text-xs font-medium", view === v ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
            >
              {k.views[v]}
            </Link>
          ))}
        </nav>
      </div>

      {view === "month" ? (
        <MonthGrid days={days} month={date.slice(0, 7)} today={today} byDay={byDay} onOpen={open} onNew={newAt} dayHref={(d) => href({ view: "day", date: d })} />
      ) : (
        <>
          <div className="hidden md:block">
            <TimeGrid days={days} today={today} byDay={byDay} onOpen={open} onNew={newAt} dayHref={(d) => href({ view: "day", date: d })} />
          </div>
          <div className="md:hidden">
            <Agenda days={days} today={today} byDay={byDay} onOpen={open} onNew={newAt} />
          </div>
        </>
      )}

      {dialog && (
        <EventDialog
          event={dialog.event}
          draft={dialog.draft}
          members={members}
          meId={meId}
          canAssign={canAssign}
          onClose={() => setDialog(null)}
          onSaved={(saved, deletedId) => {
            setDialog(null);
            setEvents((all) => {
              if (saved?.recurrence) return all;
              const gone = deletedId ?? saved?.id;
              const rest = all.filter((e) => e.id !== gone);
              // A one-off event lands where it belongs; repeating ones come back expanded on refresh
              return saved && !saved.recurrence && dayKey(saved.startAt) >= days[0]! && dayKey(saved.startAt) <= days[days.length - 1]! ? [...rest, saved] : rest;
            });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

type GridProps = {
  days: string[];
  today: string;
  byDay: Map<string, Item[]>;
  onOpen: (ev: CalendarEventDto) => void;
  onNew: (day: string, hour?: number) => void;
};

function Chip({ item, onOpen, compact }: { item: Item; onOpen: (ev: CalendarEventDto) => void; compact?: boolean }) {
  const { t } = useI18n();
  if (item.kind === "task") {
    return (
      <Link
        href={`/tasks/${item.task.id}`}
        className={clsx("flex items-center gap-1 truncate rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] text-fg-muted hover:bg-muted", item.task.status === "DONE" && "line-through")}
        title={`${t.calendar.taskDue}: ${item.task.title}`}
      >
        <CheckSquare className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{item.task.title}</span>
      </Link>
    );
  }
  const ev = item.ev;
  return (
    <button
      type="button"
      onClick={() => onOpen(ev)}
      className={clsx("flex w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-[11px] font-medium", KIND_STYLE[ev.kind], ev.outcome === "canceled" && "line-through opacity-60")}
    >
      {ev.kind === "call" && <Phone className="h-3 w-3 shrink-0" aria-hidden />}
      {!ev.allDay && !compact && <span className="tabular shrink-0 opacity-80">{timeOf(ev.startAt)}</span>}
      <span className="truncate">{ev.title}</span>
    </button>
  );
}

const sortItems = (items: Item[]) =>
  [...items].sort((a, b) => {
    const at = a.kind === "event" ? (a.ev.allDay ? "" : a.ev.startAt) : a.task.dueAt;
    const bt = b.kind === "event" ? (b.ev.allDay ? "" : b.ev.startAt) : b.task.dueAt;
    return at.localeCompare(bt);
  });

function MonthGrid({ days, month, today, byDay, onOpen, onNew, dayHref }: GridProps & { month: string; dayHref: (d: string) => string }) {
  const { t, locale } = useI18n();
  const k = t.calendar;
  const MAX = 3;
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border bg-muted/50 text-center text-[11px] font-medium uppercase text-fg-subtle">
        {k.weekdays.map((w) => (
          <div key={w} className="py-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const items = sortItems(byDay.get(d) ?? []);
          const outside = d.slice(0, 7) !== month;
          return (
            <div key={d} className={clsx("group min-h-16 border-b border-r border-border p-1 sm:min-h-28", outside && "bg-muted/40", weekday(d) === 6 && "border-r-0")}>
              <div className="flex items-center justify-between">
                <Link
                  href={dayHref(d)}
                  aria-label={formatDate(dayStart(d), locale, "long")}
                  className={clsx(
                    "grid h-6 w-6 place-items-center rounded-full text-xs tabular",
                    d === today ? "bg-accent font-semibold text-accent-fg" : outside ? "text-fg-subtle" : "text-fg hover:bg-muted",
                  )}
                >
                  {Number(d.slice(8))}
                </Link>
                <button
                  type="button"
                  onClick={() => onNew(d)}
                  aria-label={`${k.newEvent} ${d}`}
                  className="hidden h-6 w-6 place-items-center rounded text-fg-subtle hover:bg-muted hover:text-fg focus:grid group-hover:grid"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Phones: dots; wider screens: the items themselves */}
              <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                {items.slice(0, 4).map((it, i) => (
                  <span key={i} className={clsx("h-1.5 w-1.5 rounded-full", it.kind === "task" ? "bg-fg-subtle" : it.ev.kind === "call" ? "bg-success" : "bg-accent")} />
                ))}
              </div>
              <div className="mt-1 hidden space-y-0.5 sm:block">
                {items.slice(0, MAX).map((it) => (
                  <Chip key={it.kind === "event" ? `${it.ev.id}${it.ev.startAt}` : it.task.id} item={it} onOpen={onOpen} />
                ))}
                {items.length > MAX && (
                  <Link href={dayHref(d)} className="block px-1 text-[11px] text-fg-muted hover:text-fg">
                    {interpolate(k.more, { n: items.length - MAX })}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Minutes since the day's local midnight, clipped to the day. */
function minutesIn(day: string, iso: string) {
  const m = (new Date(iso).getTime() - new Date(dayStart(day)).getTime()) / 60_000;
  return Math.max(0, Math.min(1440, m));
}

function TimeGrid({ days, today, byDay, onOpen, onNew, dayHref }: GridProps & { dayHref: (d: string) => string }) {
  const { t, locale } = useI18n();
  const k = t.calendar;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Start the working day in view
    if (scroller.current) scroller.current.scrollTop = 8 * HOUR_PX;
  }, []);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="card overflow-hidden">
      <div className="grid border-b border-border" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d) => {
          const top = sortItems((byDay.get(d) ?? []).filter((it) => it.kind === "task" || it.ev.allDay));
          return (
            <div key={d} className="min-w-0 border-l border-border p-1.5">
              <Link href={dayHref(d)} className="flex items-baseline gap-1.5 text-xs text-fg-muted hover:text-fg">
                <span>{k.weekdays[weekday(d)]}</span>
                <span className={clsx("tabular text-base font-semibold", d === today ? "text-accent" : "text-fg")}>{formatDate(dayStart(d), locale, "day")}</span>
              </Link>
              <div className="mt-1 space-y-0.5">
                {top.map((it) => (
                  <Chip key={it.kind === "event" ? `${it.ev.id}${it.ev.startAt}` : it.task.id} item={it} onOpen={onOpen} compact />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div ref={scroller} className="relative max-h-[65vh] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="tabular absolute right-2 -translate-y-1/2 text-[10px] text-fg-subtle" style={{ top: h * HOUR_PX }}>
                {h ? `${String(h).padStart(2, "0")}:00` : ""}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const timed = (byDay.get(d) ?? []).flatMap((it) => (it.kind === "event" && !it.ev.allDay ? [it.ev] : []));
            const placed = placeColumns(timed.map((ev) => ({ ev, s: minutesIn(d, ev.startAt), e: Math.max(minutesIn(d, ev.endAt), minutesIn(d, ev.startAt) + 20) })));
            const nowTop = now !== null && d === today ? minutesIn(d, new Date(now).toISOString()) : null;
            return (
              <div key={d} className="relative border-l border-border">
                {Array.from({ length: 24 }, (_, h) => (
                  <button
                    key={h}
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    onClick={() => onNew(d, h)}
                    className="absolute inset-x-0 border-t border-border/60 hover:bg-muted/60"
                    style={{ top: h * HOUR_PX, height: HOUR_PX }}
                  />
                ))}
                {placed.map(({ ev, s, e, col, cols }) => (
                  <button
                    key={`${ev.id}${ev.startAt}`}
                    type="button"
                    onClick={() => onOpen(ev)}
                    className={clsx("absolute overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm", KIND_STYLE[ev.kind], ev.outcome === "canceled" && "opacity-60")}
                    style={{ top: (s / 60) * HOUR_PX, height: Math.max(((e - s) / 60) * HOUR_PX - 2, 20), left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                  >
                    <span className="flex items-center gap-1 font-semibold">
                      {ev.kind === "call" && <Phone className="h-3 w-3 shrink-0" aria-hidden />}
                      <span className="truncate">{ev.title}</span>
                    </span>
                    <span className="tabular block opacity-80">
                      {timeOf(ev.startAt)}–{timeOf(ev.endAt)}
                    </span>
                    {ev.contact && <span className="block truncate opacity-80">{ev.contact.name}</span>}
                  </button>
                ))}
                {nowTop !== null && <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: (nowTop / 60) * HOUR_PX }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Side-by-side columns for overlapping events (greedy, per day). */
function placeColumns<T extends { s: number; e: number }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - a.e);
  const out: (T & { col: number; cols: number })[] = [];
  let cluster: (T & { col: number; cols: number })[] = [];
  let clusterEnd = -1;
  let ends: number[] = [];
  const flush = () => {
    for (const x of cluster) x.cols = ends.length;
    out.push(...cluster);
    cluster = [];
    ends = [];
  };
  for (const it of sorted) {
    if (it.s >= clusterEnd) flush();
    let col = ends.findIndex((end) => end <= it.s);
    if (col < 0) col = ends.push(it.e) - 1;
    else ends[col] = it.e;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  flush();
  return out;
}

function Agenda({ days, today, byDay, onOpen, onNew }: GridProps) {
  const { t, locale } = useI18n();
  const k = t.calendar;
  const withItems = days.filter((d) => (byDay.get(d) ?? []).length || d === today || days.length === 1);
  return (
    <div className="space-y-3">
      {withItems.length === 0 && <p className="card px-5 py-10 text-center text-sm text-fg-muted">{k.empty}</p>}
      {withItems.map((d) => {
        const items = sortItems(byDay.get(d) ?? []);
        return (
          <section key={d} className="card">
            <header className="flex items-center justify-between border-b border-border px-4 py-2">
              <h3 className={clsx("text-sm font-semibold", d === today && "text-accent")}>
                {k.weekdays[weekday(d)]}, {formatDate(dayStart(d), locale, "long")}
              </h3>
              <button type="button" onClick={() => onNew(d)} aria-label={`${k.newEvent} ${d}`} className="grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:bg-muted">
                <Plus className="h-4 w-4" />
              </button>
            </header>
            {items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-fg-muted">{k.empty}</p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((it) => (
                  <li key={it.kind === "event" ? `${it.ev.id}${it.ev.startAt}` : it.task.id}>
                    {it.kind === "task" ? (
                      <Link href={`/tasks/${it.task.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted">
                        <span className="tabular w-11 shrink-0 text-xs text-fg-subtle">{timeOf(it.task.dueAt)}</span>
                        <CheckSquare className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
                        <span className="truncate">{it.task.title}</span>
                      </Link>
                    ) : (
                      <button type="button" onClick={() => onOpen(it.ev)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted">
                        <span className="tabular w-11 shrink-0 pt-0.5 text-xs text-fg-subtle">{it.ev.allDay ? k.fields.allDay : timeOf(it.ev.startAt)}</span>
                        <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", it.ev.kind === "call" ? "bg-success" : it.ev.kind === "meeting" ? "bg-accent" : "bg-fg-subtle")} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{it.ev.title}</span>
                          <span className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
                            {it.ev.contact && <span>{it.ev.contact.name}</span>}
                            {it.ev.location && (
                              <span className="inline-flex items-center gap-0.5">
                                <MapPin className="h-3 w-3" aria-hidden />
                                {it.ev.location}
                              </span>
                            )}
                            {it.ev.recurrence && <Repeat className="h-3 w-3" aria-label={k.repeats} />}
                          </span>
                        </span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
