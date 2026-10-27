import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";
import { clearTokens, REFRESH_COOKIE } from "@/lib/auth/cookies";

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await apiPublic("/v1/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) });
  }
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  clearTokens(res.cookies);
  return res;
}
