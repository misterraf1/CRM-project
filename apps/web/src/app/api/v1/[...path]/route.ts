import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, API_URL, clientIpHeader } from "@/lib/auth/cookies";

// Same-origin proxy for client components: attaches the httpOnly access token.
// Auth endpoints are excluded so tokens can never be read by browser JS.
// Bodies are streamed both ways, so JSON, multipart uploads, file downloads and the
// inbox event stream all work. /api/v1/widget/* is the anonymous website-chat API.

type Ctx = { params: Promise<{ path: string[] }> };

const PASS_THROUGH = ["content-type", "content-disposition", "content-length", "x-content-type-options", "content-security-policy", "cache-control"];

async function proxy(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  if (path[0] === "auth") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  }
  // CSRF: state-changing calls must come from our own pages
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== req.headers.get("host")) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Cross-site request" } }, { status: 403 });
    }
  }

  // The anonymous widget API needs no token (and must not use a logged-in agent's)
  const isWidget = path[0] === "widget";
  const contentType = req.headers.get("content-type");
  const upstream = await fetch(`${API_URL}/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`, {
    method: req.method,
    headers: {
      ...clientIpHeader(req.headers),
      ...(isWidget ? {} : { authorization: `Bearer ${req.cookies.get(ACCESS_COOKIE)?.value ?? ""}` }),
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

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
