import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, ADMIN_COOKIE, REFRESH_COOKIE } from "./lib/auth/cookies";

// The website chat widget and its API calls are used by anonymous site visitors;
// provider webhooks, the health check and the cron trigger authenticate themselves
const PUBLIC = [
  /^\/login$/,
  /^\/signup$/,
  /^\/forgot-password$/,
  /^\/reset-password\//,
  /^\/invite\//,
  /^\/auth\//,
  /^\/widget\//,
  /^\/api\/v1\/widget\//,
  // Customer links to quotes and invoices (the secret in the link is the credential)
  /^\/p\//,
  // Website forms, unsubscribe links and the customer portal (the key/secret in the link)
  /^\/f\//,
  /^\/u\//,
  /^\/c\//,
  /^\/api\/v1\/public\//,
  /^\/v1\/webhooks\//,
  /^\/health$/,
  /^\/api\/cron$/,
];

function unauthenticated(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, { status: 401 });
  }
  const url = new URL("/login", req.url);
  if (req.nextUrl.pathname !== "/" && req.nextUrl.pathname !== "/dashboard") {
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  }
  return NextResponse.redirect(url);
}

/**
 * Keeps the session alive: when the short-lived access cookie is gone but a refresh
 * token exists, pages detour through /auth/refresh and the API proxy refreshes inline.
 * Middleware never calls the API (it runs before route handlers and stays cheap).
 */
export async function middleware(req: NextRequest) {
  // Platform console: its own session, never the company one
  const path = req.nextUrl.pathname;
  if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/")) return adminGate(req);
  if (PUBLIC.some((re) => re.test(req.nextUrl.pathname))) return NextResponse.next();
  if (req.cookies.get(ACCESS_COOKIE)) return NextResponse.next();

  if (!req.cookies.get(REFRESH_COOKIE)) return unauthenticated(req);

  // The API proxy rotates the token itself
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  const url = new URL("/auth/refresh", req.url);
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  // 303 so a POST (server action) comes back as a GET
  return NextResponse.redirect(url, req.method === "GET" ? 307 : 303);
}

function adminGate(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path === "/admin/login" || path.startsWith("/admin/auth/")) return NextResponse.next();
  if (req.cookies.get(ADMIN_COOKIE)) {
    // The console layout needs the path (2FA setup is the only page open before 2FA is on)
    const headers = new Headers(req.headers);
    headers.set("x-axis-path", path);
    return NextResponse.next({ request: { headers } });
  }
  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, { status: 401 });
  }
  const url = new URL("/admin/login", req.url);
  if (path !== "/admin") url.searchParams.set("next", path + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)"],
};
