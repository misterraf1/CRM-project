import "server-only";
import type { ApiError, ErrorCode } from "@axis/shared";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, ADMIN_COOKIE, apiUrl, clientIpHeader } from "../auth/cookies";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

/** Calls the API with the caller's access token. A rejected session ends at /auth/expired. */
export const apiFetch = <T>(path: string, init: RequestInit = {}) => authedFetch<T>(ACCESS_COOKIE, "/auth/expired", path, init);

/** Platform console calls (/v1/admin/*) with the staff session; expired → staff sign-in. */
export const adminFetch = <T>(path: string, init: RequestInit = {}) => authedFetch<T>(ADMIN_COOKIE, "/admin/login", `/v1/admin${path}`, init);

async function authedFetch<T>(cookie: string, expired: string, path: string, init: RequestInit): Promise<T> {
  const token = (await cookies()).get(cookie)?.value;
  const res = await fetch(apiUrl(path), {
    ...init,
    cache: "no-store",
    headers: {
      ...clientIpHeader(await headers()),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) redirect(expired);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(res.status, body?.error.code ?? "INTERNAL", body?.error.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Public endpoints (login, signup, invites): returns the error instead of redirecting. */
export async function apiPublic<T>(path: string, init: RequestInit = {}) {
  const url = apiUrl(path);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: { ...clientIpHeader(await headers()), ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });
  } catch (e) {
    // API unreachable (wrong API_URL, service down): show the form error instead of a bare 500
    console.error(`API unreachable at ${new URL(url).origin}`, e);
    return { ok: false as const, status: 503, code: "INTERNAL" as ErrorCode, details: undefined };
  }
  const body = res.status === 204 ? undefined : await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiError | null)?.error;
    return { ok: false as const, status: res.status, code: err?.code ?? ("INTERNAL" as ErrorCode), details: err?.details };
  }
  return { ok: true as const, data: body as T };
}
