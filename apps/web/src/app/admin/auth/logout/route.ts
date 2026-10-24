import { NextResponse, type NextRequest } from "next/server";
import { apiPublic } from "@/lib/api/server";
import { ADMIN_COOKIE } from "@/lib/auth/cookies";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (token) await apiPublic("/v1/admin/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const res = NextResponse.redirect(new URL("/admin/login", req.url), 303);
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
