import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/api/internal";
import { getApi } from "@/server";

/** Uptime check: answers once the database responds. */
export function GET(req: NextRequest) {
  return getApi().handle(req, { ip: clientIp(req.headers) });
}
