import { Body, Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  acceptInviteSchema,
  inviteSchema,
  updateMemberSchema,
  type AcceptInviteInput,
  type InviteInput,
  type UpdateMemberInput,
} from "@axis/shared";
import { config } from "../config";
import { Public, RequirePermission } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { MembersService } from "./members.service";

@Controller("v1/members")
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @RequirePermission("members.view")
  @Get()
  list() {
    return this.members.list();
  }

  @RequirePermission("members.invite")
  @Post("invites")
  invite(@Body(new ZodPipe(inviteSchema)) body: InviteInput) {
    return this.members.invite(body);
  }

  @RequirePermission("members.manage")
  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodPipe(updateMemberSchema)) body: UpdateMemberInput) {
    return this.members.update(id, body);
  }
}

@Controller("v1/invites")
export class InvitesController {
  constructor(private readonly members: MembersService) {}

  @Public()
  @Throttle({ default: { limit: () => config().AUTH_RATE_LIMIT * 3, ttl: 60_000 } })
  @Get(":token")
  preview(@Param("token") token: string) {
    return this.members.previewInvite(token);
  }

  @Public()
  @Throttle({ default: { limit: () => config().AUTH_RATE_LIMIT, ttl: 60_000 } })
  @HttpCode(200)
  @Post(":token/accept")
  accept(@Param("token") token: string, @Body(new ZodPipe(acceptInviteSchema)) body: AcceptInviteInput) {
    return this.members.acceptInvite(token, body);
  }
}
