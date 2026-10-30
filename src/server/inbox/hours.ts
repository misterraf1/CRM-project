import type { InboxSettings } from "@/shared";

const local = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Weekday (Monday = 0) and "HH:MM" of an instant in a time zone. */
export function localClock(date: Date, timeZone: string) {
  let f = local.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    local.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: WEEKDAY[p.weekday!]!, time: `${p.hour}:${p.minute}` };
}

/** Whether the company is open at `date` (its own time zone; end time exclusive). */
export function isOpen(settings: Pick<InboxSettings, "hours">, timeZone: string, date = new Date()) {
  const { day, time } = localClock(date, timeZone);
  const d = settings.hours[day];
  return !!d?.open && time >= d.start && time < d.end;
}
