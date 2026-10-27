import "server-only";
import { cookies } from "next/headers";
import az from "./dictionaries/az";
import en from "./dictionaries/en";
import ru from "./dictionaries/ru";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./locales";

const dictionaries = { az, en, ru };

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: dictionaries[locale] };
}
