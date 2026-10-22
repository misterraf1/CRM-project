import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SkipThrottle } from "@nestjs/throttler";
import {
  addMembersSchema,
  chatEditSchema,
  chatHistoryQuerySchema,
  chatMessageSchema,
  chatSearchQuerySchema,
  directRoomSchema,
  groupRoomSchema,
  type ChatMessageInput,
  type GroupRoomInput,
} from "@axis/shared";
import type { Response } from "express";
import type { z } from "zod";
import { config } from "../config";
import { authedContext } from "../common/context";
import { ZodPipe } from "../common/zod.pipe";
import type { UploadedFile as Upload } from "../tasks/files.service";
import { ChatService } from "./chat.service";
import { ChatEvents } from "./events";

const STREAM_MAX_MS = 30 * 60_000;

@Controller("v1/chat")
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly events: ChatEvents,
  ) {}

  @Get("rooms")
  rooms() {
    return this.chat.rooms();
  }

  @Post("rooms/direct")
  direct(@Body(new ZodPipe(directRoomSchema)) body: z.infer<typeof directRoomSchema>) {
    return this.chat.direct(body.memberId);
  }

  @Post("rooms")
  group(@Body(new ZodPipe(groupRoomSchema)) body: GroupRoomInput) {
    return this.chat.group(body);
  }

  @Get("rooms/:id")
  detail(@Param("id") id: string, @Query(new ZodPipe(chatHistoryQuerySchema)) q: z.infer<typeof chatHistoryQuerySchema>) {
    return this.chat.detail(id, q.before, q.limit);
  }

  @HttpCode(204)
  @Post("rooms/:id/members")
  addMembers(@Param("id") id: string, @Body(new ZodPipe(addMembersSchema)) body: z.infer<typeof addMembersSchema>) {
    return this.chat.addMembers(id, body.memberIds);
  }

  @HttpCode(204)
  @Delete("rooms/:id/members/me")
  leave(@Param("id") id: string) {
    return this.chat.leave(id);
  }

  @Post("rooms/:id/messages")
  send(@Param("id") id: string, @Body(new ZodPipe(chatMessageSchema)) body: ChatMessageInput) {
    return this.chat.send(id, body);
  }

  @Post("rooms/:id/files")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: config().MAX_UPLOAD_MB * 1024 * 1024, files: 1 } }))
  upload(@Param("id") id: string, @UploadedFile() file: Upload | undefined, @Body("body") caption?: string) {
    return this.chat.upload(id, file, caption);
  }

  @HttpCode(204)
  @Post("rooms/:id/read")
  read(@Param("id") id: string) {
    return this.chat.read(id);
  }

  @Patch("messages/:id")
  edit(@Param("id") id: string, @Body(new ZodPipe(chatEditSchema)) body: z.infer<typeof chatEditSchema>) {
    return this.chat.edit(id, body.body);
  }

  @HttpCode(204)
  @Delete("messages/:id")
  remove(@Param("id") id: string) {
    return this.chat.remove(id);
  }

  @Get("search")
  search(@Query(new ZodPipe(chatSearchQuerySchema)) q: z.infer<typeof chatSearchQuerySchema>) {
    return this.chat.search(q.q);
  }

  /** Server-sent events for the caller's rooms only. */
  @SkipThrottle()
  @Get("stream")
  stream(@Res() res: Response) {
    const { membershipId } = authedContext();
    res.set({ "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.flushHeaders();
    res.write(": connected\n\n");
    const unsubscribe = this.events.subscribe(membershipId, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    const limit = setTimeout(() => res.end(), STREAM_MAX_MS);
    res.on("close", () => {
      unsubscribe();
      clearInterval(ping);
      clearTimeout(limit);
    });
  }
}
