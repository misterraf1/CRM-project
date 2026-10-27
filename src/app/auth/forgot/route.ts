import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const result = await apiPublic("/v1/auth/password/forgot", { method: "POST", body: JSON.stringify({ email: String(form.get("email") ?? "") }) });
  const url = new URL("/forgot-password", req.url);
  // The API answers the same for unknown emails; only real errors (validation, rate limit) show
  if (result.ok) url.searchParams.set("sent", "1");
  else url.searchParams.set("error", result.code);
  return NextResponse.redirect(url, 303);
}
