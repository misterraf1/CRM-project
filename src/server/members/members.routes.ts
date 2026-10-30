import { acceptInviteSchema, inviteSchema, notificationPrefsSchema, presenceSchema, updateMemberSchema } from "@/shared";
import { config } from "../config";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function membersRoutes(router: Router, s: Services) {
  router.group("/v1/members", {}, (r) => {
    r.get("", { permission: "members.view" }, () => s.members.list());

    r.post("invites", { permission: "members.invite", body: inviteSchema }, ({ body }) => s.members.invite(body));

    // Every member sets their own operator status
    r.patch("me/presence", { status: 204, body: presenceSchema }, async ({ body }) => {
      await s.members.setPresence(body.presence);
    });

    r.get("me/notifications", () => s.members.notificationPrefs());

    r.patch("me/notifications", { body: notificationPrefsSchema }, ({ body }) => s.members.setNotificationPrefs(body.muted));

    r.patch(":id", { permission: "members.manage", body: updateMemberSchema }, ({ params, body }) => s.members.update(params.id!, body));
  });

  router.group("/v1/invites", { public: true }, (r) => {
    r.get(":token", { throttle: { limit: () => config().AUTH_RATE_LIMIT * 3, ttl: 60_000 } }, ({ params }) => s.members.previewInvite(params.token!));

    r.post(
      ":token/accept",
      { throttle: { limit: () => config().AUTH_RATE_LIMIT, ttl: 60_000 }, status: 200, body: acceptInviteSchema },
      ({ params, body }) => s.members.acceptInvite(params.token!, body),
    );
  });
}
