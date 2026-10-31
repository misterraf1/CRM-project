import type { AuthTokens } from "@/shared";
import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";
import { MFA_COOKIE, safeNext, writeTokens } from "@/lib/auth/cookies";

// Second sign-in step: the code from the authenticator app (or a recovery code).
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const next = safeNext(form.get("next"));
  const challenge = req.cookies.get(MFA_COOKIE)?.value;
  const back = (params: Record<string, string>) => {
    const url = new URL("/login", req.url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (next !== "/dashboard") url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  };
  if (!challenge) return back({ error: "UNAUTHENTICATED" });

  const result = await apiPublic<AuthTokens>("/v1/auth/login/mfa", {
    method: "POST",
    body: JSON.stringify({ challenge, code: String(form.get("code") ?? "") }),
  });
  if (!result.ok) {
    // A wrong code keeps the step; an expired challenge starts over
    if (result.code === "MFA_INVALID") return back({ step: "code", error: result.code });
    const res = back({ error: result.code });
    res.cookies.delete({ name: MFA_COOKIE, path: "/auth" });
    return res;
  }
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.delete({ name: MFA_COOKIE, path: "/auth" });
  writeTokens(res.cookies, result.data);
  return res;
}
