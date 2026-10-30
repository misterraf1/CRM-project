import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, clearTokens, REFRESH_COOKIE, writeTokens } from "@/lib/auth/cookies";
import { crossSite, forward, joinPath, proxyError } from "@/lib/api/proxy";
import { refreshTokens } from "@/lib/auth/refresh";

// Same-origin proxy for client components: attaches the httpOnly access token.
// Auth endpoints are excluded so tokens can never be read by browser JS, and the
// platform API has its own proxy (/api/admin) with its own session.
// /api/v1/widget/* is the anonymous website-chat API, /api/v1/public/* the customer document links.

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  if (path[0] === "auth" || path[0] === "admin") return proxyError(404, "NOT_FOUND", "Not found");
  if (crossSite(req)) return proxyError(403, "FORBIDDEN", "Cross-site request");
  // The anonymous widget API and customer document links need no token (and must not use a logged-in agent's)
  if (path[0] === "widget" || path[0] === "public") return forward(req, `/v1/${joinPath(path)}`, undefined);

  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (token || !refreshToken) return forward(req, `/v1/${joinPath(path)}`, token ?? "");

  // Access cookie expired: rotate here (the middleware leaves this to us)
  const tokens = await refreshTokens(refreshToken, req.headers);
  if (!tokens) {
    const out = proxyError(401, "UNAUTHENTICATED", "Sign in required");
    clearTokens(out.cookies);
    return out;
  }
  const out = await forward(req, `/v1/${joinPath(path)}`, tokens.accessToken);
  writeTokens(out.cookies, tokens);
  return out;
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
