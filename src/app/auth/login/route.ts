import type { AuthTokens, MfaChallenge } from "@/shared";
import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";
import { safeNext, writeChallenge, writeTokens } from "@/lib/auth/cookies";

// Plain HTML form target: works without JavaScript, tokens never touch the browser's JS.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const next = safeNext(form.get("next"));
  const result = await apiPublic<AuthTokens | MfaChallenge>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: String(form.get("password") ?? "") }),
  });

  if (!result.ok) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", result.code);
    url.searchParams.set("email", email);
    if (next !== "/dashboard") url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  }
  if ("mfaRequired" in result.data) {
    // Password was right: the challenge waits in an httpOnly cookie for the code step
    const url = new URL("/login", req.url);
    url.searchParams.set("step", "code");
    if (next !== "/dashboard") url.searchParams.set("next", next);
    const res = NextResponse.redirect(url, 303);
    writeChallenge(res.cookies, result.data.challenge);
    return res;
  }
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  writeTokens(res.cookies, result.data);
  return res;
}
