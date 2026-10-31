import { caseCreateSchema, caseListQuerySchema, caseNoteSchema, caseUpdateSchema, renewalUpdateSchema, targetQuerySchema, targetSchema } from "@/shared";
import { z } from "zod";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function serviceRoutes(router: Router, s: Services) {
  router.group("/v1/cases", { permission: "cases.manage" }, (r) => {
    r.get("", { query: caseListQuerySchema }, ({ query }) => s.cases.list(query));
    r.post("", { body: caseCreateSchema }, ({ body }) => s.cases.create(body));
    r.get(":id", ({ params }) => s.cases.get(params.id!));
    r.patch(":id", { body: caseUpdateSchema }, ({ params, body }) => s.cases.update(params.id!, body));
    r.post(":id/notes", { body: caseNoteSchema }, ({ params, body }) => s.cases.addNote(params.id!, body.body));
  });

  router.group("/v1/renewals", {}, (r) => {
    r.get("", { query: z.object({ status: z.enum(["upcoming", "renewed", "lost"]).optional() }) }, ({ query }) => s.renewals.list(query));
    r.patch(":id", { body: renewalUpdateSchema }, ({ params, body }) => s.renewals.setStatus(params.id!, body.status));
  });

  router.group("/v1", {}, (r) => {
    /** Contact card: what the customer has bought and what renews next */
    r.get("contacts/:id/value", ({ params }) => s.renewals.customerValue(params.id!));

    r.get("targets", { query: targetQuerySchema }, ({ query }) => s.targets.progress(query));
    r.post("targets", { status: 200, body: targetSchema }, ({ body }) => s.targets.set(body));
    r.delete("targets/:id", { status: 204 }, ({ params }) => s.targets.remove(params.id!));
  });
}
