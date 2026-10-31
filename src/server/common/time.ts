// Calendar math in the tenant's time zone ("today", "this month" mean Baku time,
// not server time). Intl gives the wall-clock parts; we convert back to UTC instants.

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(date: Date, timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  const get = (type: string) => Number(f!.formatToParts(date).find((p) => p.type === type)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** Offset of `timeZone` from UTC at `date`, in ms (Baku: +4h). */
function offsetMs(date: Date, timeZone: string) {
  const p = parts(date, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC instant of local midnight y-m-d in `timeZone`. */
function zonedMidnight(y: number, m: number, d: number, timeZone: string) {
  const guess = new Date(Date.UTC(y, m - 1, d));
  return new Date(guess.getTime() - offsetMs(guess, timeZone));
}

export function startOfDay(date: Date, timeZone: string) {
  const p = parts(date, timeZone);
  return zonedMidnight(p.y, p.m, p.d, timeZone);
}

export function startOfMonth(date: Date, timeZone: string) {
  const p = parts(date, timeZone);
  return zonedMidnight(p.y, p.m, 1, timeZone);
}

export function addDays(date: Date, days: number, timeZone: string) {
  const p = parts(date, timeZone);
  return zonedMidnight(p.y, p.m, p.d + days, timeZone);
}

/** Local midnight on the 1st of month `m` (1–12; overflow rolls into the next years). */
export function monthStart(y: number, m: number, timeZone: string) {
  return zonedMidnight(y, m, 1, timeZone);
}

/** Year and month (1–12) of an instant in `timeZone`. */
export function localYearMonth(date: Date, timeZone: string) {
  const p = parts(date, timeZone);
  return { y: p.y, m: p.m };
}
