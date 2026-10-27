import type { AdminTokens } from "@/shared";
import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";
import { ADMIN_MFA_COOKIE, safeNext, writeAdminToken } from "@/lib/auth/cookies";

// Second sign-in step: the code from the authenticator app (or a recovery code).
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const next = safeNext(form.get("next"), "/admin");
  const challenge = req.cookies.get(ADMIN_MFA_COOKIE)?.value;
  const back = (params: Record<string, string>) => {
    const url = new URL("/admin/login", req.url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return NextResponse.redirect(url, 303);
  };
  if (!challenge) return back({ error: "UNAUTHENTICATED" });

  const result = await apiPublic<AdminTokens>("/v1/admin/auth/mfa/verify", {
    method: "POST",
    body: JSON.stringify({ challenge, code: String(form.get("code") ?? "") }),
  });
  if (!result.ok) {
    // A wrong code keeps the step; an expired challenge starts over
    if (result.code === "MFA_INVALID") return back({ step: "code", error: result.code, next });
    const res = back({ error: result.code });
    res.cookies.delete({ name: ADMIN_MFA_COOKIE, path: "/admin" });
    return res;
  }
  const res = NextResponse.redirect(new URL(next.startsWith("/admin") ? next : "/admin", req.url), 303);
  res.cookies.delete({ name: ADMIN_MFA_COOKIE, path: "/admin" });
  writeAdminToken(res.cookies, result.data);
  return res;
}
