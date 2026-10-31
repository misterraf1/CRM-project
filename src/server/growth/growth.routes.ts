import { campaignSchema, formSubmitSchema, portalCaseSchema, quoteResponseSchema, segmentSchema, webFormSchema } from "@/shared";
import { z } from "zod";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function growthRoutes(router: Router, s: Services) {
  router.group("/v1/forms", { permission: "crm.configure" }, (r) => {
    r.get("", () => s.forms.list());
    r.post("", { body: webFormSchema }, ({ body }) => s.forms.create(body));
    r.patch(":id", { body: webFormSchema }, ({ params, body }) => s.forms.update(params.id!, body));
    r.delete(":id", { status: 204 }, ({ params }) => s.forms.remove(params.id!));
  });

  router.group("/v1/campaigns", { permission: "campaigns.manage" }, (r) => {
    r.get("", () => s.campaigns.list());
    r.post("preview", { status: 200, body: segmentSchema }, ({ body }) => s.campaigns.preview(body));
    r.post("", { body: campaignSchema }, ({ body }) => s.campaigns.create(body));
    r.get(":id", ({ params }) => s.campaigns.get(params.id!));
    r.patch(":id", { body: campaignSchema }, ({ params, body }) => s.campaigns.update(params.id!, body));
    r.delete(":id", { status: 204 }, ({ params }) => s.campaigns.remove(params.id!));
    r.post(":id/send", { status: 200 }, ({ params }) => s.campaigns.send(params.id!));
  });

  router.group("/v1/contacts", { permission: "contacts.edit" }, (r) => {
    r.post(":id/portal", { body: z.object({ email: z.boolean().default(false) }) }, ({ params, body }) => s.portal.createLink(params.id!, body.email));
    r.delete(":id/portal", { status: 204 }, ({ params }) => s.portal.revoke(params.id!));
  });

  // Public: website forms, unsubscribe links, the customer portal (the key/secret in the URL is the credential)
  router.group("/v1/public", { public: true }, (r) => {
    r.get("forms/:key", { throttle: { limit: 60, ttl: 60_000 } }, ({ params }) => s.forms.publicForm(params.key!));
    r.post("forms/:key/submit", { status: 200, throttle: { limit: 10, ttl: 60_000 }, body: formSubmitSchema }, ({ params, body }) => s.forms.submit(params.key!, body));
    r.post("unsubscribe/:token", { status: 204, throttle: { limit: 20, ttl: 60_000 } }, async ({ params }) => {
      await s.campaigns.unsubscribe(params.token!);
    });
    r.get("portal/:token", { throttle: { limit: 60, ttl: 60_000 } }, ({ params }) => s.portal.view(params.token!));
    r.get("portal/:token/docs/:docId", { throttle: { limit: 60, ttl: 60_000 } }, ({ params }) => s.portal.doc(params.token!, params.docId!));
    r.post("portal/:token/docs/:docId/respond", { status: 200, throttle: { limit: 10, ttl: 60_000 }, body: quoteResponseSchema }, ({ params, body }) => s.portal.respond(params.token!, params.docId!, body));
    r.post("portal/:token/cases", { throttle: { limit: 10, ttl: 60_000 }, body: portalCaseSchema }, ({ params, body }) => s.portal.openCase(params.token!, body));
    r.post("portal/:token/files", { upload: true, throttle: { limit: 10, ttl: 60_000 } }, ({ params, file }) => s.portal.upload(params.token!, file));
  });
}
