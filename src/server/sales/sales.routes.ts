import {
  approvalActionSchema,
  docInputSchema,
  docListQuerySchema,
  docSendSchema,
  docSettingsSchema,
  logoSchema,
  orderCreateSchema,
  orderListQuerySchema,
  orderStepInputSchema,
  orderStepUpdateSchema,
  orderUpdateSchema,
  paymentSchema,
  productSchema,
  quoteResponseSchema,
} from "@/shared";
import { z } from "zod";
import type { Services } from "../container";
import type { Router } from "../http/router";

const sendBody = docSendSchema.extend({ email: z.boolean().default(true) });
const respondBody = z.object({ decision: z.enum(["accept", "reject"]) });
const createBody = docInputSchema.extend({ kind: z.enum(["quote", "invoice"]) });

/** Product catalog, quotes and invoices; the customer's link page under /v1/public. */
export function salesRoutes(router: Router, s: Services) {
  router.group("/v1/products", {}, (r) => {
    // Everyone writing quotes picks from the catalog; only managers change it
    r.get("", ({ search }) => s.products.list(search.get("all") === "1"));

    r.post("", { permission: "products.manage", body: productSchema }, ({ body }) => s.products.create(body));

    r.patch(":id", { permission: "products.manage", body: productSchema }, ({ params, body }) => s.products.update(params.id!, body));

    r.delete(":id", { permission: "products.manage", status: 200 }, ({ params }) => s.products.remove(params.id!));
  });

  // Rights are checked per kind inside (quotes.manage / invoices.manage / finance.view)
  router.group("/v1/docs", {}, (r) => {
    r.get("", { query: docListQuerySchema }, ({ query }) => s.docs.list(query));

    r.get("deal/:dealId", ({ params }) => s.docs.forDeal(params.dealId!));

    r.post("", { body: createBody }, ({ body: { kind, ...input } }) => s.docs.create(kind, input));

    r.get(":id", ({ params }) => s.docs.get(params.id!));

    r.patch(":id", { body: docInputSchema }, ({ params, body }) => s.docs.update(params.id!, body));

    r.delete(":id", { status: 204 }, ({ params }) => s.docs.remove(params.id!));

    r.post(":id/send", { status: 200, body: sendBody }, ({ params, body }) => s.docs.send(params.id!, body));

    r.post(":id/respond", { status: 200, body: respondBody }, ({ params, body }) => s.docs.respond(params.id!, body.decision));

    r.post(":id/approval", { status: 200, body: approvalActionSchema }, ({ params, body }) => s.docs.approval(params.id!, body.action, body.note ?? null));

    r.post(":id/remind", { status: 200, body: docSendSchema }, ({ params, body }) => s.docs.send(params.id!, { to: body.to, email: true, reminder: true }));

    r.post(":id/invoice", ({ params }) => s.docs.toInvoice(params.id!));

    r.post(":id/payments", { body: paymentSchema }, ({ params, body }) => s.docs.addPayment(params.id!, body));

    r.delete(":id/payments/:paymentId", { status: 200 }, ({ params }) => s.docs.removePayment(params.id!, params.paymentId!));

    r.post(":id/void", { status: 200 }, ({ params }) => s.docs.void(params.id!));
  });

  router.group("/v1/settings/documents", {}, (r) => {
    r.get("", () => s.crmSettings.docSettings());

    r.patch("", { permission: "crm.configure", body: docSettingsSchema }, ({ body }) => s.crmSettings.updateDocSettings(body));

    r.post("logo", { permission: "crm.configure", status: 200, body: logoSchema }, ({ body }) => s.crmSettings.updateLogo(body.dataUrl));
  });

  router.group("/v1/orders", { permission: "orders.manage" }, (r) => {
    r.get("", { query: orderListQuerySchema }, ({ query }) => s.orders.list(query));

    r.post("", { body: orderCreateSchema }, ({ body }) => s.orders.create(body));

    r.get(":id", ({ params }) => s.orders.get(params.id!));

    r.patch(":id", { body: orderUpdateSchema }, ({ params, body }) => s.orders.update(params.id!, body));

    r.delete(":id", { status: 204 }, ({ params }) => s.orders.remove(params.id!));

    r.post(":id/steps", { body: orderStepInputSchema }, ({ params, body }) => s.orders.addStep(params.id!, body));

    r.patch(":id/steps/:stepId", { body: orderStepUpdateSchema }, ({ params, body }) => s.orders.updateStep(params.id!, params.stepId!, body));

    r.delete(":id/steps/:stepId", { status: 200 }, ({ params }) => s.orders.removeStep(params.id!, params.stepId!));
  });

  // The customer's page: the secret in the link is the only credential
  router.group("/v1/public/docs", { public: true, throttle: { limit: 30, ttl: 60_000 } }, (r) => {
    r.get(":token", ({ params }) => s.publicDocs.view(params.token!));

    r.post(":token/respond", { status: 200, body: quoteResponseSchema }, ({ params, body }) => s.publicDocs.respond(params.token!, body));
  });
}
