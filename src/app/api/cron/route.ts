import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getApi } from "@/server";
import { config } from "@/server/config";

/**
 * Runs every background job once. A long-running server (`next start`) has its own
 * timers; serverless hosts have none, so a scheduler calls this instead (Vercel Cron
 * sends `Authorization: Bearer <CRON_SECRET>`).
 */
export async function GET(req: NextRequest) {
  const secret = config().CRON_SECRET;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Invalid cron secret" } }, { status: 401 });
  }
  const api = getApi();
  await api.runJobs();
  return NextResponse.json({ jobs: api.services.monitor.list() });
}
