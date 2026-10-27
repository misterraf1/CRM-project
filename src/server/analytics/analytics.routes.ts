import { analyticsQuerySchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function analyticsRoutes(router: Router, s: Services) {
  router.group("/v1/analytics", { permission: "analytics.view" }, (r) => {
    r.get("basic", { feature: "analytics.basic", query: analyticsQuerySchema }, ({ query }) => s.analytics.basic(query.period));

    r.get("advanced", { feature: "analytics.advanced", query: analyticsQuerySchema }, ({ query }) => s.analytics.advanced(query.period));

    // Exporting is a separate right: managers may analyse without taking the data out
    r.get(
      "export/deals.csv",
      {
        feature: "analytics.advanced",
        permission: "deals.export",
        query: analyticsQuerySchema,
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="deals.csv"', "cache-control": "no-store" },
      },
      ({ query }) => s.analytics.exportDeals(query.period),
    );
  });
}
