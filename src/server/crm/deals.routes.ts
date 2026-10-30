import { dealCreateSchema, dealListQuerySchema, dealMoveSchema, dealUpdateSchema } from "@/shared";
import { z } from "zod";
import type { Services } from "../container";
import type { Router } from "../http/router";

const forecastQuery = z.object({ pipelineId: z.string().min(1).max(64).optional() });

// Sales pipeline: PRO and up
export function dealsRoutes(router: Router, s: Services) {
  router.group("/v1", { feature: "deals.pipeline" }, (r) => {
    r.get("pipelines", () => s.deals.pipelines());

    r.get("deals", { query: dealListQuerySchema }, ({ query }) => s.deals.list(query));

    // Declared before :id so "forecast" isn't captured as an id
    r.get("deals/forecast", { query: forecastQuery }, ({ query }) => s.deals.forecast(query.pipelineId));

    r.post("deals", { permission: "deals.create", body: dealCreateSchema }, ({ body }) => s.deals.create(body));

    r.get("deals/:id", ({ params }) => s.deals.get(params.id!));

    r.patch("deals/:id", { permission: "deals.edit", body: dealUpdateSchema }, ({ params, body }) => s.deals.update(params.id!, body));

    r.post("deals/:id/move", { permission: "deals.edit", status: 200, body: dealMoveSchema }, ({ params, body }) => s.deals.move(params.id!, body));

    r.delete("deals/:id", { permission: "deals.delete", status: 204 }, ({ params }) => s.deals.remove(params.id!));
  });
}
