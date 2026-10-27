import { automationRuleSchema, automationRuleUpdateSchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function automationsRoutes(router: Router, s: Services) {
  router.group("/v1/automations", { feature: "automations", permission: "automations.manage" }, (r) => {
    r.get("", () => s.automations.list());

    r.post("", { body: automationRuleSchema }, ({ body }) => s.automations.create(body));

    r.patch(":id", { body: automationRuleUpdateSchema }, ({ params, body }) => s.automations.update(params.id!, body));

    r.delete(":id", { status: 204 }, async ({ params }) => {
      await s.automations.remove(params.id!);
    });

    r.get(":id/runs", ({ params }) => s.automations.runs(params.id!));
  });
}
