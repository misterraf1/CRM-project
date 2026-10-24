import { NextResponse, type NextRequest } from "next/server";
import { API_URL, clientIpHeader } from "@/lib/auth/cookies";

// Shared by the company proxy (/api/v1) and the platform proxy (/api/admin).
// Bodies are streamed both ways, so JSON, multipart uploads, file downloads and
// event streams all work.

const PASS_THROUGH = ["content-type", "content-disposition", "content-length", "x-content-type-options", "content-security-policy", "cache-control"];

export const proxyError = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

/** CSRF: state-changing calls must come from our own pages. */
export function crossSite(req: NextRequest) {
  if (req.method === "GET") return false;
  const origin = req.headers.get("origin");
  return !origin || new URL(origin).host !== req.headers.get("host");
}

export async function forward(req: NextRequest, upstreamPath: string, token: string | undefined) {
  const contentType = req.headers.get("content-type");
  const upstream = await fetch(`${API_URL}${upstreamPath}${req.nextUrl.search}`, {
    method: req.method,
    headers: {
      ...clientIpHeader(req.headers),
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      ...(contentType ? { "content-type": contentType } : {}),
    },
    body: req.method === "GET" ? undefined : await req.arrayBuffer(),
    cache: "no-store",
  });

  const headers = new Headers();
  for (const h of PASS_THROUGH) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers });
}

export const joinPath = (path: string[]) => path.map(encodeURIComponent).join("/");
