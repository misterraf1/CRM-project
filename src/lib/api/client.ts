"use client";

import type { ApiError, ErrorCode } from "@axis/shared";

export type ClientResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; details?: unknown };

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** Browser → same-origin proxy (/api/v1/*), which attaches the httpOnly token. FormData is sent as multipart. */
export const api = <T>(path: string, method: Method = "GET", body?: unknown) => request<T>("/api/v1", "/auth/expired", path, method, body);

/** Platform console → /api/admin/* (staff session). */
export const adminApi = <T>(path: string, method: Method = "GET", body?: unknown) => request<T>("/api/admin", "/admin/login", path, method, body);

async function request<T>(base: string, onExpired: string, path: string, method: Method, body?: unknown): Promise<ClientResult<T>> {
  let res: Response;
  const multipart = body instanceof FormData;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined || multipart ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "INTERNAL" };
  }
  const json = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  const err = (json as ApiError | undefined)?.error;
  // Only an ended session signs out; other 401s (a wrong 2FA code) are ordinary errors
  if (res.status === 401 && (!err || err.code === "UNAUTHENTICATED")) {
    window.location.assign(onExpired);
    return { ok: false, code: "UNAUTHENTICATED" };
  }
  if (!res.ok) {
    return { ok: false, code: err?.code ?? "INTERNAL", details: err?.details };
  }
  return { ok: true, data: json as T };
}
