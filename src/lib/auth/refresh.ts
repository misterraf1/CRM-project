import type { AuthTokens } from "@/shared";
import { callApi } from "../api/internal";

/** Rotates a refresh token. Only called from route handlers (middleware never touches the database). */
export async function refreshTokens(refreshToken: string, headers: Headers): Promise<AuthTokens | null> {
  const res = await callApi(
    "/v1/auth/refresh",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken }) },
    headers,
  ).catch(() => null);
  return res?.ok ? ((await res.json()) as AuthTokens) : null;
}
