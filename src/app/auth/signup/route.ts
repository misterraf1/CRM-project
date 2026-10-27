import type { AuthTokens } from "@/shared";
import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";
import { writeTokens } from "@/lib/auth/cookies";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const fields = {
    companyName: String(form.get("companyName") ?? ""),
    fullName: String(form.get("fullName") ?? ""),
    email: String(form.get("email") ?? ""),
  };
  const result = await apiPublic<AuthTokens>("/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ ...fields, password: String(form.get("password") ?? "") }),
  });

  if (!result.ok) {
    const url = new URL("/signup", req.url);
    url.searchParams.set("error", result.code);
    for (const [k, v] of Object.entries(fields)) url.searchParams.set(k, v);
    const invalid = result.details && typeof result.details === "object" ? Object.keys(result.details) : [];
    if (invalid.length) url.searchParams.set("fields", invalid.join(","));
    return NextResponse.redirect(url, 303);
  }
  const res = NextResponse.redirect(new URL("/dashboard", req.url), 303);
  writeTokens(res.cookies, result.data);
  return res;
}
