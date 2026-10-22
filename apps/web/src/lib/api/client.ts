"use client";

import type { ApiError, ErrorCode } from "@axis/shared";

export type ClientResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; details?: unknown };

/** Browser → same-origin proxy (/api/v1/*), which attaches the httpOnly token. FormData is sent as multipart. */
export async function api<T>(path: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<ClientResult<T>> {
  let res: Response;
  const multipart = body instanceof FormData;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: body === undefined || multipart ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "INTERNAL" };
  }
  if (res.status === 401) {
    window.location.assign("/auth/expired");
    return { ok: false, code: "UNAUTHENTICATED" };
  }
  const json = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (json as ApiError | undefined)?.error;
    return { ok: false, code: err?.code ?? "INTERNAL", details: err?.details };
  }
  return { ok: true, data: json as T };
}
