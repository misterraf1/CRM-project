import { departmentSchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function departmentsRoutes(router: Router, s: Services) {
  router.group("/v1/departments", {}, (r) => {
    r.get("", { permission: "members.view" }, () => s.departments.list());

    r.post("", { feature: "departments", permission: "departments.manage", body: departmentSchema }, ({ body }) => s.departments.create(body));

    r.patch(":id", { feature: "departments", permission: "departments.manage", body: departmentSchema }, ({ params, body }) =>
      s.departments.update(params.id!, body),
    );

    r.delete(":id", { permission: "departments.manage", status: 204 }, ({ params }) => s.departments.remove(params.id!));
  });
}
