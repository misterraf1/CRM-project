import { NextResponse, type NextRequest } from "next/server";
import { clearTokens } from "@/lib/auth/cookies";

// Reached when the API rejects a still-present access cookie (logout elsewhere,
// member disabled). Clears cookies so the login page doesn't bounce back.
export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login?error=SESSION_EXPIRED", req.url));
  clearTokens(res.cookies);
  return res;
}
