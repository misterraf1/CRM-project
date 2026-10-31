import { analyticsQuerySchema, savedReportSchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function analyticsRoutes(router: Router, s: Services) {
  router.group("/v1/analytics", { permission: "analytics.view" }, (r) => {
    r.get("basic", { feature: "analytics.basic", query: analyticsQuerySchema }, ({ query }) => s.analytics.basic(query));

    r.get("advanced", { feature: "analytics.advanced", query: analyticsQuerySchema }, ({ query }) => s.analytics.advanced(query));

    r.get("receivables", { feature: "analytics.basic" }, () => s.reports.receivables());
    r.get("products", { feature: "analytics.basic", query: analyticsQuerySchema }, ({ query }) => s.reports.productSales(query));
    r.get("saved", () => s.reports.saved());
    r.post("saved", { status: 200, body: savedReportSchema }, ({ body }) => s.reports.save(body));
    r.delete("saved/:id", { status: 200 }, ({ params }) => s.reports.removeSaved(params.id!));

    // Exporting is a separate right: managers may analyse without taking the data out
    r.get(
      "export/deals.csv",
      {
        feature: "analytics.advanced",
        permission: "deals.export",
        query: analyticsQuerySchema,
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="deals.csv"', "cache-control": "no-store" },
      },
      ({ query }) => s.analytics.exportDeals(query),
    );
  });
}
