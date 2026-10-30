import { roleSchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function rolesRoutes(router: Router, s: Services) {
  router.group("/v1/roles", {}, (r) => {
    // Everyone who sees the team sees which roles exist (the members screen shows them)
    r.get("", { permission: "members.view" }, () => s.roles.list());

    r.post("", { permission: "roles.manage", body: roleSchema }, ({ body }) => s.roles.create(body));

    r.patch(":id", { permission: "roles.manage", body: roleSchema }, ({ params, body }) => s.roles.update(params.id!, body));

    r.delete(":id", { permission: "roles.manage", status: 204 }, ({ params }) => s.roles.remove(params.id!));
  });
}
