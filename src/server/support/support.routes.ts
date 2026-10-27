import { ticketCreateSchema, ticketMessageSchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

// Open to every member, and usable while suspended — that's when companies need help most.
export function supportRoutes(router: Router, s: Services) {
  router.group("/v1/support/tickets", { allowInactive: true }, (r) => {
    r.get("", () => s.support.list());

    r.post("", { body: ticketCreateSchema }, ({ body }) => s.support.create(body));

    r.get(":id", ({ params }) => s.support.get(params.id!));

    r.post(":id/messages", { body: ticketMessageSchema }, ({ params, body }) => s.support.reply(params.id!, body.body));
  });
}
