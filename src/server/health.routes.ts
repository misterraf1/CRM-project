import type { Services } from "./container";
import type { Router } from "./http/router";

export function healthRoutes(router: Router, s: Services) {
  router.group("/health", { public: true, throttle: false }, (r) => {
    r.get("", async () => {
      await s.db.ping();
      return { status: "ok" };
    });
  });
}
