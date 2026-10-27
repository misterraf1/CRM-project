import type { AuthTokens } from "@/shared";
import { NextResponse, type NextRequest } from "next/server";
import { callApi } from "@/lib/api/internal";
import { ACCESS_COOKIE, writeTokens } from "@/lib/auth/cookies";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const res = await callApi(
    "/v1/auth/switch",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${req.cookies.get(ACCESS_COOKIE)?.value ?? ""}` },
      body: JSON.stringify({ tenantId: String(form.get("tenantId") ?? "") }),
    },
    req.headers,
  );
  if (!res.ok) return NextResponse.redirect(new URL("/dashboard", req.url), 303);
  const out = NextResponse.redirect(new URL("/dashboard", req.url), 303);
  writeTokens(out.cookies, (await res.json()) as AuthTokens);
  return out;
}
