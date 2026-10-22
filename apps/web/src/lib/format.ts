import type { Locale } from "./i18n/locales";

// Deterministic formatting. Browser ICU data for Azerbaijani is incomplete (Chrome
// formats `az` numbers with en grouping and units in Cyrillic), which would make
// server and client render different text. So number/unit/month wording lives here
// and only time-zone math is delegated to Intl, which is reliable everywhere.

const NUMBER = {
  az: { group: ".", decimal: "," },
  en: { group: ",", decimal: "." },
  ru: { group: " ", decimal: "," },
} satisfies Record<Locale, unknown>;

const COMPACT = { az: [" min", " mln"], en: ["K", "M"], ru: [" тыс.", " млн"] } satisfies Record<Locale, unknown>;

const UNITS = {
  az: { minute: "dəq", hour: "saat", day: "gün" },
  en: { minute: "min", hour: "h", day: "d" },
  ru: { minute: "мин", hour: "ч", day: "дн." },
} satisfies Record<Locale, unknown>;

const RELATIVE = {
  az: { now: "indicə", ago: "{d} əvvəl" },
  en: { now: "just now", ago: "{d} ago" },
  ru: { now: "только что", ago: "{d} назад" },
} satisfies Record<Locale, unknown>;

const MONTHS: Record<Locale, { short: string[]; long: string[] }> = {
  az: {
    short: ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avq", "sen", "okt", "noy", "dek"],
    long: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"],
  },
  en: {
    short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    long: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  },
  ru: {
    short: ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."],
    long: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  },
};

const CURRENCY_SYMBOL: Record<string, string> = { AZN: "₼", USD: "$", EUR: "€" };

/** Tenant time zone; becomes `session.tenant.timezone` when the API lands. */
export const TIME_ZONE = "Asia/Baku";

export function formatNumber(value: number, locale: Locale, fractionDigits = 0) {
  const { group, decimal } = NUMBER[locale];
  const [int, frac] = Math.abs(value).toFixed(fractionDigits).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${value < 0 ? "-" : ""}${grouped}${frac && Number(frac) !== 0 ? decimal + frac : ""}`;
}

function compactNumber(value: number, locale: Locale) {
  const abs = Math.abs(value);
  if (abs < 1000) return formatNumber(value, locale);
  const [k, m] = COMPACT[locale];
  return abs < 1_000_000 ? formatNumber(value / 1000, locale, 1) + k : formatNumber(value / 1_000_000, locale, 1) + m;
}

/** Money is stored in minor units (qəpik), see packages/db schema. */
export function formatMoney(minor: number, locale: Locale, currency = "AZN", compact = false) {
  const amount = compact ? compactNumber(minor / 100, locale) : formatNumber(Math.round(minor / 100), locale);
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  return locale === "en" ? `${symbol}${amount}` : `${amount} ${symbol}`;
}

/** "45 dəq", "3 saat", "2 gün" — a duration without "ago". */
export function formatDuration(minutes: number, locale: Locale) {
  const [value, unit] =
    minutes < 60
      ? [Math.max(1, Math.round(minutes)), "minute" as const]
      : minutes < 1440
        ? [Math.round(minutes / 60), "hour" as const]
        : [Math.round(minutes / 1440), "day" as const];
  return `${value} ${UNITS[locale][unit]}`;
}

export function formatRelative(iso: string, now: Date, locale: Locale) {
  const minutes = (now.getTime() - new Date(iso).getTime()) / 60000;
  if (minutes < 1) return RELATIVE[locale].now;
  return RELATIVE[locale].ago.replace("{d}", formatDuration(minutes, locale));
}

const zonedParts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, day: "numeric", month: "numeric" });

/** "day" → "23", "short" → "23 okt", "long" → "23 oktyabr" (in the tenant time zone). */
export function formatDate(iso: string, locale: Locale, style: "day" | "short" | "long" = "short") {
  const parts = zonedParts.formatToParts(new Date(iso));
  const day = parts.find((p) => p.type === "day")!.value;
  if (style === "day") return day;
  const month = MONTHS[locale][style][Number(parts.find((p) => p.type === "month")!.value) - 1]!;
  return `${day} ${month}`;
}

/** Percent change; null when there is no baseline to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** "1 250,50" / "1250.5" → 125050 minor units; null when not a valid non-negative amount. */
export function parseMoneyInput(value: string): number | null {
  const normalised = value.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(normalised)) return null;
  return Math.round(Number(normalised) * 100);
}

/** Minor units → plain editable string ("1250.5"). */
export function moneyInputValue(minor: number) {
  return String(minor / 100);
}

const zonedFull = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function wallClock(date: Date) {
  const p = Object.fromEntries(zonedFull.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour!, min: p.minute! };
}

/** "22 okt, 18:00" in the tenant time zone; time omitted at midnight. */
export function formatDateTime(iso: string, locale: Locale) {
  const { h, min } = wallClock(new Date(iso));
  const date = formatDate(iso, locale, "short");
  return h === "00" && min === "00" ? date : `${date}, ${h}:${min}`;
}

/** ISO → value for <input type="datetime-local">, as wall-clock time in the tenant zone. */
export function toDateTimeInput(iso: string | null) {
  if (!iso) return "";
  const { y, m, d, h, min } = wallClock(new Date(iso));
  return `${y}-${m}-${d}T${h}:${min}`;
}

/** <input type="datetime-local"> value (tenant wall-clock time) → ISO instant. */
export function fromDateTimeInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, m - 1, d, h, min);
  // Offset of the tenant zone at that moment (Baku: +4h)
  const p = wallClock(new Date(asUtc));
  const offset = Date.UTC(+p.y, +p.m - 1, +p.d, +p.h, +p.min) - asUtc;
  return new Date(asUtc - offset).toISOString();
}
