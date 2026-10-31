import type { CalendarFeedDto } from "@/shared";
import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar/CalendarView";
import { getMembers, getSession } from "@/lib/api";
import { apiFetch } from "@/lib/api/server";
import { addDaysKey, dayKey, dayStart, isDayKey, visibleDays, type CalendarView as View } from "@/lib/calendar";

export const metadata: Metadata = { title: "Calendar" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function CalendarPage({ searchParams }: Props) {
  const [sp, session, members] = await Promise.all([searchParams, getSession(), getMembers()]);
  const view: View = sp.view === "day" || sp.view === "week" ? sp.view : "month";
  const today = dayKey(new Date().toISOString());
  const date = isDayKey(sp.date) ? sp.date : today;
  const p = session.permissions;
  const canSeeOthers = p.includes("tasks.view_all") || p.includes("records.view_department");
  const member = canSeeOthers && sp.member ? sp.member : "mine";
  const days = visibleDays(view, date);
  const from = dayStart(days[0]!);
  const to = dayStart(addDaysKey(days[days.length - 1]!, 1));
  const feed = await apiFetch<CalendarFeedDto>(`/v1/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&member=${encodeURIComponent(member)}`);
  const contact = sp.contact && sp.contactName ? { id: sp.contact, name: sp.contactName } : null;
  const start = new Date(Date.now() + 3_600_000);
  start.setMinutes(0, 0, 0);

  return (
    <CalendarView
      view={view}
      date={date}
      today={today}
      days={days}
      member={member}
      events={feed.events}
      tasks={feed.tasks}
      members={members}
      meId={session.membership.id}
      canAssign={p.includes("tasks.assign_any")}
      canSeeOthers={canSeeOthers}
      openEventId={sp.event}
      newDraft={sp.new ? { startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), contact, kind: sp.kind === "call" ? "call" : "meeting" } : undefined}
    />
  );
}
