import { teamStatsQuerySchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

// Employee monitoring: PRO and up
export function teamRoutes(router: Router, s: Services) {
  router.group("/v1/team", { feature: "team.monitoring" }, (r) => {
    r.get("stats", { query: teamStatsQuerySchema }, ({ query }) => s.team.stats(query.period));

    r.get(":memberId", ({ params }) => s.team.profile(params.memberId!));
  });
}
