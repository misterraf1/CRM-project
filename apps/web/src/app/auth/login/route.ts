import type { AuthTokens } from "@axis/shared";
import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";
import { safeNext, writeTokens } from "@/lib/auth/cookies";

// Plain HTML form target: works without JavaScript, tokens never touch the browser's JS.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const next = safeNext(form.get("next"));
  const result = await apiPublic<AuthTokens>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: String(form.get("password") ?? "") }),
    headers: { "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "" },
  });

  if (!result.ok) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", result.code);
    url.searchParams.set("email", email);
    if (next !== "/dashboard") url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  }
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  writeTokens(res.cookies, result.data);
  return res;
}
