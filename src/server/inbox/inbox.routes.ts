import {
  cannedResponseSchema,
  channelCreateSchema,
  conversationListQuerySchema,
  conversationUpdateSchema,
  inboxMetricsQuerySchema,
  linkContactSchema,
  sendMessageSchema,
  simulateInboundSchema,
  templateMessageSchema,
  inboxSettingsSchema,
  type InboxEvent,
} from "@/shared";
import { authedContext } from "../common/context";
import type { Services } from "../container";
import type { Router } from "../http/router";
import { eventStream } from "../http/sse";

export function inboxRoutes(router: Router, s: Services) {
  router.group("/v1/inbox", {}, (r) => {
    r.get("conversations", { query: conversationListQuerySchema }, ({ query }) => s.inbox.list(query));

    r.get("conversations/:id", ({ params }) => s.inbox.get(params.id!));

    r.post("conversations/:id/messages", { body: sendMessageSchema }, ({ params, body }) => s.inbox.send(params.id!, body));

    r.post("conversations/:id/files", { upload: true }, ({ params, file, fields }) => s.inbox.sendFile(params.id!, file, fields.caption));

    r.post("conversations/:id/template", { body: templateMessageSchema }, ({ params, body }) => s.inbox.sendTemplate(params.id!, body));

    /** AI draft of the next reply — filled into the composer, never sent by itself */
    r.post("conversations/:id/ai/reply", { permission: "inbox.reply" }, ({ params }) => s.inboxAi.reply(params.id!));

    r.post("conversations/:id/ai/summary", ({ params }) => s.inboxAi.summary(params.id!));

    r.patch("conversations/:id", { body: conversationUpdateSchema }, ({ params, body }) => s.inbox.update(params.id!, body));

    r.post("conversations/:id/read", { status: 204 }, ({ params }) => s.inbox.markRead(params.id!));

    r.post("conversations/:id/contact", { body: linkContactSchema }, ({ params, body }) => s.inbox.linkContact(params.id!, body));

    r.get("metrics", { query: inboxMetricsQuerySchema }, ({ query }) => s.inbox.metrics(query.period));

    r.get("settings", () => s.inbox.settings());

    r.patch("settings", { permission: "channels.manage", body: inboxSettingsSchema }, ({ body }) => s.inbox.updateSettings(body));

    r.get("templates", () => s.inbox.templates());

    r.post("templates", { permission: "inbox.assign", body: cannedResponseSchema }, ({ body }) => s.inbox.createTemplate(body));

    r.delete("templates/:id", { permission: "inbox.assign", status: 204 }, ({ params }) => s.inbox.deleteTemplate(params.id!));

    r.get("channels", () => s.channels.list());

    r.post("channels", { permission: "channels.manage", body: channelCreateSchema }, ({ body }) => s.channels.create(body));

    r.delete("channels/:id", { permission: "channels.manage", status: 204 }, ({ params }) => s.channels.disconnect(params.id!));

    r.post("channels/:id/templates/sync", { permission: "channels.manage", status: 200 }, ({ params }) => s.channels.syncTemplates(params.id!));

    r.post("channels/:id/simulate", { permission: "channels.manage", body: simulateInboundSchema }, ({ params, body }) =>
      s.channels.simulate(params.id!, body),
    );

    /** Server-sent events: ids of changed conversations; clients re-fetch what they may see. */
    r.get("stream", { throttle: false }, ({ req }) => {
      const { tenantId } = authedContext();
      return eventStream<InboxEvent>(req.signal, (send) => s.inboxEvents.subscribe(tenantId, send));
    });
  });
}
