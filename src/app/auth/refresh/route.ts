import { NextResponse, type NextRequest } from "next/server";
import { clearTokens, REFRESH_COOKIE, safeNext, writeTokens } from "@/lib/auth/cookies";
import { refreshTokens } from "@/lib/auth/refresh";

// The middleware sends page requests here when the access cookie is gone but a
// refresh token exists; the new tokens are set and the user lands where they were going.
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  const tokens = refreshToken ? await refreshTokens(refreshToken, req.headers) : null;

  if (!tokens) {
    const url = new URL("/login", req.url);
    if (next !== "/dashboard") url.searchParams.set("next", next);
    const out = NextResponse.redirect(url);
    clearTokens(out.cookies);
    return out;
  }

  const out = NextResponse.redirect(new URL(next, req.url));
  writeTokens(out.cookies, tokens);
  return out;
}
