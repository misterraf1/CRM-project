import { VIEW_ENTITIES, objectCreateSchema, objectUpdateSchema, recordInputSchema, recordListQuerySchema, savedViewCreateSchema, apiKeyCreateSchema, inboundCreateSchema, inboundUpdateSchema, webhookCreateSchema, webhookUpdateSchema } from "@/shared";
import { z } from "zod";
import type { Services } from "../container";
import type { Router } from "../http/router";
import { openApi } from "./openapi";

/** API keys, outgoing webhooks, and the public API's description. */
export function integrationsRoutes(router: Router, s: Services) {
  router.group("/v1/integrations", { permission: "integrations.manage" }, (r) => {
    r.get("api-keys", () => s.apiKeys.list());
    r.post("api-keys", { body: apiKeyCreateSchema }, ({ body }) => s.apiKeys.create(body.name, body.scopes));
    r.delete("api-keys/:id", { status: 200 }, ({ params }) => s.apiKeys.revoke(params.id!));

    r.get("webhooks", () => s.hooks.list());
    r.post("webhooks", { body: webhookCreateSchema }, ({ body }) => s.hooks.create(body));
    r.patch("webhooks/:id", { body: webhookUpdateSchema }, ({ params, body }) => s.hooks.update(params.id!, body));
    r.delete("webhooks/:id", { status: 200 }, ({ params }) => s.hooks.remove(params.id!));
    r.get("webhooks/:id/deliveries", ({ params }) => s.hooks.deliveries(params.id!));
    r.get("inbound", () => s.inbound.list());
    r.post("inbound", { body: inboundCreateSchema }, ({ body }) => s.inbound.create(body));
    r.patch("inbound/:id", { body: inboundUpdateSchema }, ({ params, body }) => s.inbound.update(params.id!, body));
    r.delete("inbound/:id", { status: 200 }, ({ params }) => s.inbound.remove(params.id!));
    r.post("webhooks/:id/test", { status: 200, throttle: { limit: 10, ttl: 60_000 } }, ({ params }) => s.hooks.test(params.id!));
  });

  // Saved list views (every member has their own; shared ones need crm.configure)
  router.group("/v1/views", {}, (r) => {
    r.get("", { query: z.object({ entity: z.enum(VIEW_ENTITIES) }) }, ({ query }) => s.views.list(query.entity));
    r.post("", { body: savedViewCreateSchema }, ({ body }) => s.views.create(body));
    r.delete(":id", { status: 200 }, ({ params }) => s.views.remove(params.id!));
  });

  // The company's own sections and their records
  router.group("/v1/objects", {}, (r) => {
    r.get("", () => s.objects.list());
    r.post("", { permission: "crm.configure", body: objectCreateSchema }, ({ body }) => s.objects.create(body));
    r.patch(":id", { permission: "crm.configure", body: objectUpdateSchema }, ({ params, body }) => s.objects.update(params.id!, body));
    r.delete(":id", { permission: "crm.configure", status: 200 }, ({ params }) => s.objects.remove(params.id!));
    r.get(":id/records", { query: recordListQuerySchema }, ({ params, query }) => s.objects.records(params.id!, query));
    r.post(":id/records", { permission: "contacts.create", body: recordInputSchema }, ({ params, body }) => s.objects.createRecord(params.id!, body));
  });
  router.group("/v1/records", {}, (r) => {
    r.get(":id", ({ params }) => s.objects.get(params.id!));
    r.patch(":id", { permission: "contacts.edit", body: recordInputSchema.partial() }, ({ params, body }) => s.objects.updateRecord(params.id!, body));
    r.delete(":id", { permission: "contacts.delete", status: 204 }, ({ params }) => s.objects.removeRecord(params.id!));
  });

  router.group("/v1", {}, (r) => {
    r.get("openapi.json", { public: true }, () => openApi());
    // Incoming integrations: the address itself is the credential (plus signatures where the provider signs)
    r.post("public/in/:address", { public: true, status: 200, throttle: { limit: 120, ttl: 60_000 } }, ({ params, req, raw }) => s.inbound.receive(params.address!, req, raw));
    // Zadarma checks a notification URL with GET ?zd_echo=…
    r.get("public/in/:address", { public: true, throttle: { limit: 30, ttl: 60_000 } }, ({ search }) => search.get("zd_echo") ?? "ok");
  });
}
