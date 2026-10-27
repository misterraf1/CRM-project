import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/api/internal";
import { getApi } from "@/server";

// Provider webhooks (Meta, inbound email) call the API directly — the only API paths
// served publicly. Signature/token checks happen in the API (src/server/inbox).
function handle(req: NextRequest) {
  return getApi().handle(req, { ip: clientIp(req.headers) });
}

export { handle as GET, handle as POST };
