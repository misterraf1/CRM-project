import type { AuthTokens } from "@axis/shared";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, API_URL, clearTokens, clientIpHeader, REFRESH_COOKIE, writeTokens } from "./lib/auth/cookies";

// The website chat widget and its API calls are used by anonymous site visitors
const PUBLIC = [/^\/login$/, /^\/signup$/, /^\/invite\//, /^\/auth\//, /^\/widget\//, /^\/api\/v1\/widget\//];

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
 * token exists, rotate it before the request reaches pages or the API proxy.
 */
export async function middleware(req: NextRequest) {
  if (PUBLIC.some((re) => re.test(req.nextUrl.pathname))) return NextResponse.next();
  if (req.cookies.get(ACCESS_COOKIE)) return NextResponse.next();

  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return unauthenticated(req);

  const res = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", ...clientIpHeader(req.headers) },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => null);

  if (!res?.ok) {
    const out = unauthenticated(req);
    clearTokens(out.cookies);
    return out;
  }

  const tokens = (await res.json()) as AuthTokens;
  // Make the new tokens visible to this same request (server components read cookies)…
  req.cookies.set(ACCESS_COOKIE, tokens.accessToken);
  req.cookies.set(REFRESH_COOKIE, tokens.refreshToken);
  const out = NextResponse.next({ request: { headers: req.headers } });
  // …and persist them in the browser
  writeTokens(out.cookies, tokens);
  return out;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)"],
};
