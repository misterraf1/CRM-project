import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  loginSchema,
  refreshSchema,
  signupSchema,
  switchTenantSchema,
  type LoginInput,
  type SignupInput,
} from "@axis/shared";
import type { z } from "zod";
import { config } from "../config";
import { AllowInactive, Public } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { AuthService } from "./auth.service";
import { TokensService } from "./tokens.service";

const authLimit = { default: { limit: () => config().AUTH_RATE_LIMIT, ttl: 60_000 } };

@Controller("v1/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  @Public()
  @Throttle(authLimit)
  @Post("signup")
  signup(@Body(new ZodPipe(signupSchema)) body: SignupInput) {
    return this.auth.signup(body);
  }

  @Public()
  @Throttle(authLimit)
  @HttpCode(200)
  @Post("login")
  login(@Body(new ZodPipe(loginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  @Public()
  @HttpCode(200)
  @Post("refresh")
  refresh(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.tokens.rotate(body.refreshToken);
  }

  @Public()
  @HttpCode(204)
  @Post("logout")
  async logout(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    await this.tokens.revokeByRefreshToken(body.refreshToken);
  }

  @AllowInactive()
  @HttpCode(200)
  @Post("switch")
  switch(@Body(new ZodPipe(switchTenantSchema)) body: z.infer<typeof switchTenantSchema>) {
    return this.auth.switchTenant(body.tenantId);
  }
}

@Controller("v1/me")
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  me() {
    return this.auth.me();
  }
}
