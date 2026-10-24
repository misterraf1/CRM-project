import type { NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";
import { crossSite, forward, joinPath, proxyError } from "@/lib/api/proxy";

// Same-origin proxy for client components: attaches the httpOnly access token.
// Auth endpoints are excluded so tokens can never be read by browser JS, and the
// platform API has its own proxy (/api/admin) with its own session.
// /api/v1/widget/* is the anonymous website-chat API.

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  if (path[0] === "auth" || path[0] === "admin") return proxyError(404, "NOT_FOUND", "Not found");
  if (crossSite(req)) return proxyError(403, "FORBIDDEN", "Cross-site request");
  // The anonymous widget API needs no token (and must not use a logged-in agent's)
  const token = path[0] === "widget" ? undefined : (req.cookies.get(ACCESS_COOKIE)?.value ?? "");
  return forward(req, `/v1/${joinPath(path)}`, token);
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
