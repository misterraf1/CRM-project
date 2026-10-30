import { searchQuerySchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function searchRoutes(router: Router, s: Services) {
  router.group("/v1/search", {}, (r) => {
    r.get("", { query: searchQuerySchema }, ({ query }) => s.search.search(query.q));
  });
}
