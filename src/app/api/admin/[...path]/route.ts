import type { NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth/cookies";
import { crossSite, forward, joinPath, proxyError } from "@/lib/api/proxy";

// Platform console → /v1/admin/*, with the staff session cookie. Sign-in/out go
// through /admin/auth/* form handlers, so the token never reaches browser JS.

type Ctx = { params: Promise<{ path: string[] }> };

const MFA_MANAGEMENT = new Set(["setup", "enable", "recovery-codes", "disable"]);

async function proxy(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  // Token-issuing calls (login, 2FA verify) only go through the form handlers; the
  // 2FA management calls of a signed-in staff member may pass
  if (path[0] === "auth" && !(path[1] === "mfa" && MFA_MANAGEMENT.has(path[2] ?? ""))) return proxyError(404, "NOT_FOUND", "Not found");
  if (crossSite(req)) return proxyError(403, "FORBIDDEN", "Cross-site request");
  return forward(req, `/v1/admin/${joinPath(path)}`, req.cookies.get(ADMIN_COOKIE)?.value ?? "");
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
