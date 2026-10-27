import type { AuthTokens } from "@axis/shared";
import { apiUrl, clientIpHeader } from "./cookies";

/**
 * Rotates a refresh token. Only called from route handlers: on Vercel the API is
 * reached through a service binding, which middleware can't use.
 */
export async function refreshTokens(refreshToken: string, headers: Headers): Promise<AuthTokens | null> {
  const res = await fetch(apiUrl("/v1/auth/refresh"), {
    method: "POST",
    headers: { "content-type": "application/json", ...clientIpHeader(headers) },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as AuthTokens) : null;
}
