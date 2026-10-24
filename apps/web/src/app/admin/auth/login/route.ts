import type { AdminTokens } from "@axis/shared";
import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";
import { safeNext, writeAdminToken } from "@/lib/auth/cookies";

// Plain HTML form target, like the company login.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const next = safeNext(form.get("next"), "/admin");
  const result = await apiPublic<AdminTokens>("/v1/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: String(form.get("password") ?? "") }),
  });
  if (!result.ok) {
    const url = new URL("/admin/login", req.url);
    url.searchParams.set("error", result.code);
    url.searchParams.set("email", email);
    return NextResponse.redirect(url, 303);
  }
  const res = NextResponse.redirect(new URL(next.startsWith("/admin") ? next : "/admin", req.url), 303);
  writeAdminToken(res.cookies, result.data);
  return res;
}
