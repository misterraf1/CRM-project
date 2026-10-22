import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, API_URL } from "@/lib/auth/cookies";

// Same-origin proxy for client components: attaches the httpOnly access token.
// Auth endpoints are excluded so tokens can never be read by browser JS.

type Ctx = { params: Promise<{ path: string[] }> };

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

  const upstream = await fetch(`${API_URL}/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`, {
    method: req.method,
    headers: {
      authorization: `Bearer ${req.cookies.get(ACCESS_COOKIE)?.value ?? ""}`,
      ...(req.method !== "GET" ? { "content-type": "application/json" } : {}),
    },
    body: req.method === "GET" ? undefined : await req.text(),
    cache: "no-store",
  });
  return new NextResponse(upstream.status === 204 ? null : await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
