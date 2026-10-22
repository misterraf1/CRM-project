import type { Dictionary } from "./dictionaries/az";
import { interpolate } from "./locales";

export type UiErrorCode = keyof Dictionary["errors"];

/** Maps an API error code (or ?error= param) to a localized message. */
export function errorMessage(t: Dictionary, code: unknown, details?: unknown): string | undefined {
  if (typeof code !== "string" || !code) return undefined;
  const template = t.errors[code as UiErrorCode] ?? t.errors.INTERNAL;
  const vars = details && typeof details === "object" ? (details as Record<string, string | number>) : {};
  return interpolate(template, vars);
}
