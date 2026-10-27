"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Dictionary } from "./dictionaries/az";
import type { Locale } from "./locales";

const I18nContext = createContext<{ locale: Locale; t: Dictionary } | null>(null);

export function I18nProvider({ locale, t, children }: { locale: Locale; t: Dictionary; children: ReactNode }) {
  return <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
