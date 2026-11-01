import { NextResponse, type NextRequest } from "next/server";
import { callApi } from "./internal";

// Shared by the company proxy (/api/v1) and the platform proxy (/api/admin): the
// browser's cookie session becomes a bearer token for the in-process API. Responses
// are streamed, so JSON, file downloads and event streams all work.

const PASS_THROUGH = ["content-type", "content-disposition", "content-length", "x-content-type-options", "content-security-policy", "cache-control"];

export const proxyError = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

/** CSRF: state-changing calls must come from our own pages. */
export function crossSite(req: NextRequest) {
  if (req.method === "GET") return false;
  const origin = req.headers.get("origin");
  return !origin || new URL(origin).host !== req.headers.get("host");
}

/** Signature headers of shops calling an incoming integration (checked by the API) */
const SIGNATURES = /^x-(shopify-hmac-sha256|shopify-topic|wc-webhook-signature|wc-webhook-topic)$/;

export async function forward(req: NextRequest, upstreamPath: string, token: string | undefined) {
  const contentType = req.headers.get("content-type");
  const signatures = upstreamPath.startsWith("/v1/public/in/") ? [...req.headers].filter(([h]) => SIGNATURES.test(h)) : [];
  const upstream = await callApi(
    `${upstreamPath}${req.nextUrl.search}`,
    {
      method: req.method,
      headers: {
        ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
        ...(contentType ? { "content-type": contentType } : {}),
        ...Object.fromEntries(signatures),
      },
      body: req.method === "GET" ? undefined : await req.arrayBuffer(),
      // Event streams end when the browser goes away
      signal: req.signal,
    },
    req.headers,
  );

  const headers = new Headers();
  for (const h of PASS_THROUGH) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers });
}

export const joinPath = (path: string[]) => path.map(encodeURIComponent).join("/");
