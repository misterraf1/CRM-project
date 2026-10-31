import { z } from "zod";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function aiRoutes(router: Router, s: Services) {
  router.group("/v1/ai", {}, (r) => {
    r.post("contacts/:id/insight", { status: 200 }, ({ params }) => s.crmAi.contactInsight(params.id!));
    r.post("deals/:id/insight", { status: 200 }, ({ params }) => s.crmAi.dealInsight(params.id!));
    r.post("ask", { status: 200, throttle: { limit: 20, ttl: 60_000 }, body: z.object({ question: z.string().trim().min(3).max(500) }) }, ({ body }) => s.crmAi.ask(body.question));
  });
}
