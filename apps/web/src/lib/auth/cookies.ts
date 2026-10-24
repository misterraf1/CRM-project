import type { AdminTokens, AuthTokens } from "@axis/shared";

// Tokens live in httpOnly cookies on the web origin (BFF pattern): browser JS never
// sees them; server components and route handlers attach them to API calls.

export const ACCESS_COOKIE = "axis_at";
export const REFRESH_COOKIE = "axis_rt";
/** Platform staff (Super Admin) session — separate from any company session. */
export const ADMIN_COOKIE = "axis_adm";
/** Between the password and the 2FA code step (5 minutes, platform sign-in only). */
export const ADMIN_MFA_COOKIE = "axis_adm_mfa";

export const API_URL = process.env.API_URL ?? "http://localhost:4000";

const base = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production" };

interface CookieJar {
  set(name: string, value: string, options: Record<string, unknown>): unknown;
  delete(name: string): unknown;
}

export function writeTokens(jar: CookieJar, tokens: AuthTokens) {
  // Expire the access cookie a minute early so the middleware refreshes before the JWT dies
  jar.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: Math.max(60, tokens.expiresIn - 60) });
  jar.set(REFRESH_COOKIE, tokens.refreshToken, { ...base, expires: new Date(tokens.refreshExpiresAt) });
}

export function writeAdminToken(jar: CookieJar, tokens: AdminTokens) {
  // Strict: admin actions are never triggered by links from other sites
  jar.set(ADMIN_COOKIE, tokens.accessToken, { ...base, sameSite: "strict", expires: new Date(tokens.expiresAt) });
}

export function writeAdminChallenge(jar: CookieJar, challenge: string) {
  jar.set(ADMIN_MFA_COOKIE, challenge, { ...base, sameSite: "strict", path: "/admin", maxAge: 300 });
}

export function clearTokens(jar: CookieJar) {
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

/** Only same-site relative paths, so `?next=` can't become an open redirect. */
export function safeNext(value: unknown, fallback = "/dashboard") {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : fallback;
}

/**
 * Client IP to forward to the API, so its per-IP rate limits see real users instead
 * of this server. Next.js sets x-forwarded-for from the socket when there is no proxy.
 */
export function clientIpHeader(headers: Headers): Record<string, string> {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip");
  return ip ? { "x-forwarded-for": ip } : {};
}
