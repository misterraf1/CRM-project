import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";
import { clearTokens } from "@/lib/auth/cookies";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const result = await apiPublic("/v1/auth/password/reset", { method: "POST", body: JSON.stringify({ token, password: String(form.get("password") ?? "") }) });
  if (!result.ok) {
    const url = new URL(`/reset-password/${encodeURIComponent(token)}`, req.url);
    url.searchParams.set("error", result.code);
    return NextResponse.redirect(url, 303);
  }
  const res = NextResponse.redirect(new URL("/login?reset=1", req.url), 303);
  // Every session was ended by the reset, this browser's included
  clearTokens(res.cookies);
  return res;
}
