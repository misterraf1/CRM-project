import type { Services } from "../container";
import type { Router } from "../http/router";

// Reading notices (e.g. "payment failed") must work while suspended
export function notificationsRoutes(router: Router, s: Services) {
  router.group("/v1", { allowInactive: true }, (r) => {
    r.get("notifications", () => s.notifications.list());

    r.post("notifications/read-all", { status: 204 }, () => s.notifications.markAllRead());

    r.post("notifications/:id/read", { status: 204 }, ({ params }) => s.notifications.markRead(params.id!));

    r.get("me/summary", () => s.notifications.summary());
  });
}
