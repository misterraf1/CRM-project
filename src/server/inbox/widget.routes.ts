import { widgetMessageSchema, type WidgetConfigDto, type WidgetMessageDto, type WidgetSendResponse } from "@/shared";
import type { Message } from "../db/models";
import { z } from "zod";
import { AppError, notFound } from "../common/errors";
import { randomToken, sha256 } from "../common/ids";
import type { Services } from "../container";
import { memberRefs } from "../crm/scope";
import type { Router } from "../http/router";
import type { Tx } from "../db/database";

const pollQuery = z.object({ visitorToken: z.string().min(20).max(100), after: z.string().datetime().optional() });

/** Key format `<tenantId>.<channelId>` — public, embedded in the customer's website. */
function parseKey(key: string) {
  const [tenantId, channelId, ...rest] = key.split(".");
  if (!tenantId || !channelId || rest.length) throw notFound("Widget");
  return { tenantId, channelId };
}

/**
 * Public API of the website chat widget. Visitors are identified by a random token
 * the widget keeps in localStorage; only sha256(token) is stored as the thread id.
 * Visitors only ever see customer-facing messages — internal notes are filtered here.
 */
export function widgetRoutes(router: Router, s: Services) {
  const channelOf = async (tx: Tx, tenantId: string, channelId: string) => {
    const channel = await tx.channel.findOne({ id: channelId, tenantId, type: "WEBCHAT", status: { $ne: "disconnected" } });
    if (!channel) throw new AppError("NOT_FOUND", "Widget not found");
    return channel;
  };

  router.group("/v1/widget", { public: true }, (r) => {
    r.get(":key/config", { throttle: { limit: 60, ttl: 60_000 } }, ({ params }): Promise<WidgetConfigDto> => {
      const { tenantId, channelId } = parseKey(params.key!);
      return s.db.scoped(
        async (tx) => {
          const channel = await channelOf(tx, tenantId, channelId);
          const tenant = await tx.tenant.get({ id: tenantId }, { projection: { name: 1 } });
          return { companyName: tenant.name, channelName: channel.name, greeting: (channel.settings as { greeting?: string }).greeting ?? null };
        },
        { tenantId },
      );
    });

    r.post(":key/messages", { throttle: { limit: 20, ttl: 60_000 }, body: widgetMessageSchema }, ({ params, body }): Promise<WidgetSendResponse> => {
      const { tenantId, channelId } = parseKey(params.key!);
      const visitorToken = body.visitorToken ?? randomToken(24);
      return s.db.scoped(
        async (tx) => {
          const channel = await channelOf(tx, tenantId, channelId);
          const thread = sha256(visitorToken);
          const result = await s.ingest.inbound(tx, channel, {
            externalThread: thread,
            body: body.body,
            displayName: body.name ?? null,
            handle: body.email ?? null,
          });
          const m = await tx.message.get({ id: result!.messageId });
          return { visitorToken, message: { id: m.id, from: "visitor", body: m.body ?? "", authorName: null, createdAt: m.createdAt.toISOString() } };
        },
        { tenantId },
      );
    });

    r.get(":key/messages", { throttle: { limit: 60, ttl: 60_000 }, query: pollQuery }, ({ params, query: q }): Promise<WidgetMessageDto[]> => {
      const { tenantId, channelId } = parseKey(params.key!);
      return s.db.scoped(
        async (tx) => {
          await channelOf(tx, tenantId, channelId);
          const conversation = await tx.conversation.findOne({ channelId, externalThread: sha256(q.visitorToken) });
          if (!conversation) return [];
          const messages = await tx.message.find(
            { tenantId, conversationId: conversation.id, direction: { $in: ["INBOUND", "OUTBOUND"] }, ...(q.after ? { createdAt: { $gt: new Date(q.after) } } : {}) },
            { sort: { createdAt: 1, id: 1 }, limit: 200 },
          );
          const refs = await memberRefs(tx, tenantId, messages.map((m) => m.authorId));
          return messages.map((m: Message) => ({
            id: m.id,
            from: m.direction === "INBOUND" ? "visitor" : "agent",
            body: m.body ?? "",
            // First name only: visitors don't need staff surnames
            authorName: m.authorId ? (refs.get(m.authorId)?.name.split(" ")[0] ?? null) : null,
            createdAt: m.createdAt.toISOString(),
          }));
        },
        { tenantId },
      );
    });
  });
}
