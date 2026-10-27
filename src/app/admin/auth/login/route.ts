import type { AdminMfaChallenge, AdminTokens } from "@axis/shared";
import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";
import { safeNext, writeAdminChallenge, writeAdminToken } from "@/lib/auth/cookies";

// Plain HTML form target, like the company login.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const next = safeNext(form.get("next"), "/admin");
  const result = await apiPublic<AdminTokens | AdminMfaChallenge>("/v1/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: String(form.get("password") ?? "") }),
  });
  if (!result.ok) {
    const url = new URL("/admin/login", req.url);
    url.searchParams.set("error", result.code);
    url.searchParams.set("email", email);
    return NextResponse.redirect(url, 303);
  }
  const target = next.startsWith("/admin") ? next : "/admin";
  if ("mfaRequired" in result.data) {
    // Password was right: the challenge waits in an httpOnly cookie for the code step
    const url = new URL("/admin/login", req.url);
    url.searchParams.set("step", "code");
    url.searchParams.set("next", target);
    const res = NextResponse.redirect(url, 303);
    writeAdminChallenge(res.cookies, result.data.challenge);
    return res;
  }
  const res = NextResponse.redirect(new URL(target, req.url), 303);
  writeAdminToken(res.cookies, result.data);
  return res;
}
