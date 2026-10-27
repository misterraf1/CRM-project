import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { widgetMessageSchema, type WidgetConfigDto, type WidgetMessageDto, type WidgetMessageInput, type WidgetSendResponse } from "@axis/shared";
import type { Message } from "@prisma/client";
import { z } from "zod";
import { Public } from "../common/decorators";
import { AppError, notFound } from "../common/errors";
import { randomToken, sha256 } from "../common/ids";
import { ZodPipe } from "../common/zod.pipe";
import { memberRefs } from "../crm/scope";
import { PrismaService, type Tx } from "../prisma/prisma.service";
import { IngestService } from "./ingest.service";

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
@Controller("v1/widget")
export class WidgetController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(":key/config")
  config(@Param("key") key: string): Promise<WidgetConfigDto> {
    const { tenantId, channelId } = parseKey(key);
    return this.prisma.scoped(
      async (tx) => {
        const channel = await this.channel(tx, tenantId, channelId);
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
        return { companyName: tenant.name, channelName: channel.name, greeting: (channel.settings as { greeting?: string }).greeting ?? null };
      },
      { tenantId },
    );
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(":key/messages")
  send(@Param("key") key: string, @Body(new ZodPipe(widgetMessageSchema)) body: WidgetMessageInput): Promise<WidgetSendResponse> {
    const { tenantId, channelId } = parseKey(key);
    const visitorToken = body.visitorToken ?? randomToken(24);
    return this.prisma.scoped(
      async (tx) => {
        const channel = await this.channel(tx, tenantId, channelId);
        const thread = sha256(visitorToken);
        const result = await this.ingest.inbound(tx, channel, {
          externalThread: thread,
          body: body.body,
          displayName: body.name ?? null,
          handle: body.email ?? null,
        });
        const m = await tx.message.findUniqueOrThrow({ where: { id: result!.messageId } });
        return { visitorToken, message: { id: m.id, from: "visitor", body: m.body ?? "", authorName: null, createdAt: m.createdAt.toISOString() } };
      },
      { tenantId },
    );
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(":key/messages")
  poll(@Param("key") key: string, @Query(new ZodPipe(pollQuery)) q: z.infer<typeof pollQuery>): Promise<WidgetMessageDto[]> {
    const { tenantId, channelId } = parseKey(key);
    return this.prisma.scoped(
      async (tx) => {
        await this.channel(tx, tenantId, channelId);
        const conversation = await tx.conversation.findUnique({
          where: { channelId_externalThread: { channelId, externalThread: sha256(q.visitorToken) } },
        });
        if (!conversation) return [];
        const messages = await tx.message.findMany({
          where: {
            tenantId,
            conversationId: conversation.id,
            direction: { in: ["INBOUND", "OUTBOUND"] },
            ...(q.after ? { createdAt: { gt: new Date(q.after) } } : {}),
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 200,
        });
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
  }

  private async channel(tx: Tx, tenantId: string, channelId: string) {
    const channel = await tx.channel.findFirst({ where: { id: channelId, tenantId, type: "WEBCHAT", status: { not: "disconnected" } } });
    if (!channel) throw new AppError("NOT_FOUND", "Widget not found");
    return channel;
  }
}
