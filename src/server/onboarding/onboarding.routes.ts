import { applyTemplateSchema, workspaceSchema } from "@/shared";
import { z } from "zod";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function onboardingRoutes(router: Router, s: Services) {
  router.group("/v1/onboarding", {}, (r) => {
    r.get("", () => s.onboarding.state());
    r.patch("", { permission: "crm.configure", body: z.object({ dismissed: z.boolean() }) }, ({ body }) => s.onboarding.dismiss(body.dismissed));
    r.get("templates", { permission: "crm.configure" }, () => s.onboarding.templates());
    r.post("template", { permission: "crm.configure", body: applyTemplateSchema }, ({ body }) => s.onboarding.applyTemplate(body.key, body.makeDefault, body.setup));
    r.post("demo", { permission: "crm.configure", status: 200 }, () => s.onboarding.addDemo());
    r.delete("demo", { permission: "crm.configure", status: 200 }, () => s.onboarding.removeDemo());
  });
  router.group("/v1/settings/workspace", {}, (r) => {
    r.get("", () => s.onboarding.workspace());
    r.patch("", { permission: "crm.configure", body: workspaceSchema }, ({ body }) => s.onboarding.updateWorkspace(body));
  });
}
