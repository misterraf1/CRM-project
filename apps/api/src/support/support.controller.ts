import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ticketCreateSchema, ticketMessageSchema, type TicketCreateInput } from "@axis/shared";
import { AllowInactive } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { SupportService } from "./support.service";

// Open to every member, and usable while suspended — that's when companies need help most.
@AllowInactive()
@Controller("v1/support/tickets")
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list() {
    return this.support.list();
  }

  @Post()
  create(@Body(new ZodPipe(ticketCreateSchema)) body: TicketCreateInput) {
    return this.support.create(body);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.support.get(id);
  }

  @Post(":id/messages")
  reply(@Param("id") id: string, @Body(new ZodPipe(ticketMessageSchema)) body: { body: string }) {
    return this.support.reply(id, body.body);
  }
}
