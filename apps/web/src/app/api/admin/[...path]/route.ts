import type { NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth/cookies";
import { crossSite, forward, joinPath, proxyError } from "@/lib/api/proxy";

// Platform console → /v1/admin/*, with the staff session cookie. Sign-in/out go
// through /admin/auth/* form handlers, so the token never reaches browser JS.

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  if (path[0] === "auth") return proxyError(404, "NOT_FOUND", "Not found");
  if (crossSite(req)) return proxyError(403, "FORBIDDEN", "Cross-site request");
  return forward(req, `/v1/admin/${joinPath(path)}`, req.cookies.get(ADMIN_COOKIE)?.value ?? "");
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
