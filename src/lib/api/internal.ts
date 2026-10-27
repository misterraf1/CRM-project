import "server-only";
import { getApi } from "@/server";

// The backend runs inside this Next.js server (src/server): pages, route handlers and
// the browser proxy call it in-process — no network hop, no separate API service.

/** The browser's IP, for the API's per-IP rate limits, sessions and audit. */
export function clientIp(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || undefined;
}

/** Calls an API path (e.g. `/v1/me`) as a fetch would, on behalf of the request with these headers. */
export function callApi(path: string, init: RequestInit, from: Headers): Promise<Response> {
  return getApi().handle(new Request(new URL(path, "http://axis.internal"), init), { ip: clientIp(from) });
}
