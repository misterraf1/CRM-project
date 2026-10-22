import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import {
  cannedResponseSchema,
  channelCreateSchema,
  conversationListQuerySchema,
  conversationUpdateSchema,
  inboxMetricsQuerySchema,
  linkContactSchema,
  sendMessageSchema,
  simulateInboundSchema,
  type CannedResponseInput,
  type ChannelCreateInput,
  type ConversationListQuery,
  type ConversationUpdateInput,
  type SendMessageInput,
  type SimulateInboundInput,
} from "@axis/shared";
import type { Response } from "express";
import type { z } from "zod";
import { authedContext } from "../common/context";
import { RequirePermission } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { ChannelsService } from "./channels.service";
import { InboxEvents } from "./events";
import { InboxService } from "./inbox.service";

const STREAM_MAX_MS = 30 * 60_000;

@Controller("v1/inbox")
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly channels: ChannelsService,
    private readonly events: InboxEvents,
  ) {}

  @Get("conversations")
  list(@Query(new ZodPipe(conversationListQuerySchema)) query: ConversationListQuery) {
    return this.inbox.list(query);
  }

  @Get("conversations/:id")
  get(@Param("id") id: string) {
    return this.inbox.get(id);
  }

  @Post("conversations/:id/messages")
  send(@Param("id") id: string, @Body(new ZodPipe(sendMessageSchema)) body: SendMessageInput) {
    return this.inbox.send(id, body);
  }

  @Patch("conversations/:id")
  update(@Param("id") id: string, @Body(new ZodPipe(conversationUpdateSchema)) body: ConversationUpdateInput) {
    return this.inbox.update(id, body);
  }

  @HttpCode(204)
  @Post("conversations/:id/read")
  read(@Param("id") id: string) {
    return this.inbox.markRead(id);
  }

  @Post("conversations/:id/contact")
  linkContact(@Param("id") id: string, @Body(new ZodPipe(linkContactSchema)) body: z.infer<typeof linkContactSchema>) {
    return this.inbox.linkContact(id, body);
  }

  @Get("metrics")
  metrics(@Query(new ZodPipe(inboxMetricsQuerySchema)) query: z.infer<typeof inboxMetricsQuerySchema>) {
    return this.inbox.metrics(query.period);
  }

  @Get("templates")
  templates() {
    return this.inbox.templates();
  }

  @RequirePermission("inbox.assign")
  @Post("templates")
  createTemplate(@Body(new ZodPipe(cannedResponseSchema)) body: CannedResponseInput) {
    return this.inbox.createTemplate(body);
  }

  @RequirePermission("inbox.assign")
  @HttpCode(204)
  @Delete("templates/:id")
  deleteTemplate(@Param("id") id: string) {
    return this.inbox.deleteTemplate(id);
  }

  @Get("channels")
  channelList() {
    return this.channels.list();
  }

  @RequirePermission("channels.manage")
  @Post("channels")
  channelCreate(@Body(new ZodPipe(channelCreateSchema)) body: ChannelCreateInput) {
    return this.channels.create(body);
  }

  @RequirePermission("channels.manage")
  @HttpCode(204)
  @Delete("channels/:id")
  channelDisconnect(@Param("id") id: string) {
    return this.channels.disconnect(id);
  }

  @RequirePermission("channels.manage")
  @Post("channels/:id/simulate")
  simulate(@Param("id") id: string, @Body(new ZodPipe(simulateInboundSchema)) body: SimulateInboundInput) {
    return this.channels.simulate(id, body);
  }

  /** Server-sent events: ids of changed conversations; clients re-fetch what they may see. */
  @SkipThrottle()
  @Get("stream")
  stream(@Res() res: Response) {
    const { tenantId } = authedContext();
    res.set({ "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.flushHeaders();
    res.write(": connected\n\n");
    const unsubscribe = this.events.subscribe(tenantId, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    // Long-lived streams outlive token checks; close periodically so the client reconnects re-authenticated
    const limit = setTimeout(() => res.end(), STREAM_MAX_MS);
    res.on("close", () => {
      unsubscribe();
      clearInterval(ping);
      clearTimeout(limit);
    });
  }
}
