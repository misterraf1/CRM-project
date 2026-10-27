import type { AuthTokens } from "@axis/shared";
import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";
import { writeTokens } from "@/lib/auth/cookies";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await req.formData();
  const fullName = String(form.get("fullName") ?? "").trim();
  const result = await apiPublic<AuthTokens>(`/v1/invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    body: JSON.stringify({ password: String(form.get("password") ?? ""), ...(fullName ? { fullName } : {}) }),
  });

  if (!result.ok) {
    const url = new URL(`/invite/${token}`, req.url);
    url.searchParams.set("error", result.code);
    return NextResponse.redirect(url, 303);
  }
  const res = NextResponse.redirect(new URL("/dashboard", req.url), 303);
  writeTokens(res.cookies, result.data);
  return res;
}
