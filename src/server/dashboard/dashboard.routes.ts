import { dashboardQuerySchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function dashboardRoutes(router: Router, s: Services) {
  router.group("/v1/dashboard", {}, (r) => {
    r.get("", { query: dashboardQuerySchema }, ({ query }) => s.dashboard.crm(query.period));

    r.get("attention", () => s.attention.list());
  });
}
