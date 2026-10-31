import { fromDateTimeInput, toDateTimeInput } from "./format";

// Calendar grid math on wall-clock days ("YYYY-MM-DD" in the company time zone), so a
// meeting at 01:00 Baku time sits on its Baku day whatever the viewer's browser zone.

export type CalendarView = "day" | "week" | "month";

/** Day of an instant: "2026-10-31" */
export const dayKey = (iso: string) => toDateTimeInput(iso).slice(0, 10);

/** "HH:MM" of an instant */
export const timeOf = (iso: string) => toDateTimeInput(iso).slice(11, 16);

/** Instant at which a day starts */
export const dayStart = (key: string) => fromDateTimeInput(`${key}T00:00`)!;

const asUtc = (key: string) => new Date(`${key}T00:00:00Z`);
const toKey = (d: Date) => d.toISOString().slice(0, 10);

export const addDaysKey = (key: string, n: number) => {
  const d = asUtc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return toKey(d);
};

/** Monday = 0 … Sunday = 6 */
export const weekday = (key: string) => (asUtc(key).getUTCDay() + 6) % 7;

export const isDayKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(asUtc(v).getTime());

/** Days shown by a view: a day, Monday–Sunday, or the whole weeks covering a month. */
export function visibleDays(view: CalendarView, key: string): string[] {
  if (view === "day") return [key];
  if (view === "week") {
    const monday = addDaysKey(key, -weekday(key));
    return Array.from({ length: 7 }, (_, i) => addDaysKey(monday, i));
  }
  const first = `${key.slice(0, 7)}-01`;
  const start = addDaysKey(first, -weekday(first));
  const next = asUtc(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDaysKey(toKey(next), -1);
  const end = addDaysKey(last, 6 - weekday(last));
  const days: string[] = [];
  for (let d = start; d <= end; d = addDaysKey(d, 1)) days.push(d);
  return days;
}

/** Where "previous"/"next" go from a day in a view */
export function shift(view: CalendarView, key: string, dir: 1 | -1) {
  if (view === "day") return addDaysKey(key, dir);
  if (view === "week") return addDaysKey(key, 7 * dir);
  const d = asUtc(`${key.slice(0, 7)}-01`);
  d.setUTCMonth(d.getUTCMonth() + dir);
  return toKey(d);
}
