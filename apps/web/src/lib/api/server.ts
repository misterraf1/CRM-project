import "server-only";
import type { ApiError, ErrorCode } from "@axis/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, API_URL } from "../auth/cookies";

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
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) redirect("/auth/expired");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(res.status, body?.error.code ?? "INTERNAL", body?.error.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Public endpoints (login, signup, invites): returns the error instead of redirecting. */
export async function apiPublic<T>(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  const body = res.status === 204 ? undefined : await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiError | null)?.error;
    return { ok: false as const, status: res.status, code: err?.code ?? ("INTERNAL" as ErrorCode), details: err?.details };
  }
  return { ok: true as const, data: body as T };
}
