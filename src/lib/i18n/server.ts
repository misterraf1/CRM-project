import "server-only";
import { cookies } from "next/headers";
import az from "./dictionaries/az";
import en from "./dictionaries/en";
import ru from "./dictionaries/ru";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./locales";
import { withTerms } from "./terms";

const dictionaries = { az, en, ru };

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: dictionaries[locale] };
}

/** Inside the signed-in app: the dictionary with the company's own words applied. */
export async function getAppI18n() {
  const [{ locale, t }, session] = await Promise.all([getI18n(), (await import("@/lib/api")).getSession()]);
  return { locale, t: withTerms(t, locale, session.tenant.workspace?.terms) };
}
