export const LOCALES = ["az", "en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "az";
export const LOCALE_COOKIE = "locale";

export const LOCALE_LABELS: Record<Locale, string> = { az: "AZ", en: "EN", ru: "RU" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Replaces `{name}` placeholders. Unknown placeholders are left untouched. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}
