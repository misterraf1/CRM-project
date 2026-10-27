import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  adminInvoiceQuerySchema,
  adminLoginSchema,
  adminMfaVerifySchema,
  mfaCodeSchema,
  adminTenantQuerySchema,
  expenseSchema,
  extendTrialSchema,
  planUpdateSchema,
  suspendSchema,
  ticketMessageSchema,
  ticketUpdateSchema,
  TICKET_STATUSES,
  type ExpenseInput,
  type PlanUpdateInput,
  type TicketStatus,
} from "@axis/shared";
import { Throttle } from "@nestjs/throttler";
import type { z } from "zod";
import { config } from "../config";
import { currentContext } from "../common/context";
import { Public } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { SupportService } from "../support/support.service";
import { AdminAuthService } from "./admin-auth.service";
import { AdminGuard, AllowWithoutMfa, SuperAdminOnly } from "./admin.guard";
import { AdminService } from "./admin.service";

// Platform staff sign-in. Separate from /v1/auth: other issuer, no tenant.
@Public()
@Controller("v1/admin/auth")
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Throttle({ default: { limit: () => config().AUTH_RATE_LIMIT, ttl: 60_000 } })
  @HttpCode(200)
  @Post("login")
  login(@Body(new ZodPipe(adminLoginSchema)) body: z.infer<typeof adminLoginSchema>) {
    return this.auth.login(body.email, body.password);
  }

  @Throttle({ default: { limit: () => config().AUTH_RATE_LIMIT, ttl: 60_000 } })
  @HttpCode(200)
  @Post("mfa/verify")
  verifyMfa(@Body(new ZodPipe(adminMfaVerifySchema)) body: z.infer<typeof adminMfaVerifySchema>) {
    return this.auth.verifyMfa(body.challenge, body.code);
  }

  @UseGuards(AdminGuard)
  @AllowWithoutMfa()
  @HttpCode(204)
  @Post("logout")
  async logout() {
    await this.auth.logout(currentContext().adminSessionId!);
  }

  @UseGuards(AdminGuard)
  @AllowWithoutMfa()
  @Get("me")
  me() {
    return this.auth.me(currentContext().userId!);
  }

  @UseGuards(AdminGuard)
  @AllowWithoutMfa()
  @Post("mfa/setup")
  setupMfa() {
    return this.auth.setupMfa(currentContext().userId!);
  }

  @UseGuards(AdminGuard)
  @AllowWithoutMfa()
  @Throttle({ default: { limit: () => config().AUTH_RATE_LIMIT, ttl: 60_000 } })
  @HttpCode(200)
  @Post("mfa/enable")
  enableMfa(@Body(new ZodPipe(mfaCodeSchema)) body: { code: string }) {
    return this.auth.enableMfa(currentContext().userId!, body.code);
  }

  @UseGuards(AdminGuard)
  @Throttle({ default: { limit: () => config().AUTH_RATE_LIMIT, ttl: 60_000 } })
  @HttpCode(200)
  @Post("mfa/recovery-codes")
  regenerateRecoveryCodes(@Body(new ZodPipe(mfaCodeSchema)) body: { code: string }) {
    return this.auth.regenerateRecoveryCodes(currentContext().userId!, body.code);
  }

  @UseGuards(AdminGuard)
  @Throttle({ default: { limit: () => config().AUTH_RATE_LIMIT, ttl: 60_000 } })
  @HttpCode(204)
  @Post("mfa/disable")
  async disableMfa(@Body(new ZodPipe(mfaCodeSchema)) body: { code: string }) {
    await this.auth.disableMfa(currentContext().userId!, body.code);
  }
}

@Public()
@UseGuards(AdminGuard)
@Controller("v1/admin")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly support: SupportService,
  ) {}

  @Get("overview")
  overview() {
    return this.admin.overview();
  }

  @Get("tenants")
  tenants(@Query(new ZodPipe(adminTenantQuerySchema)) q: z.infer<typeof adminTenantQuerySchema>) {
    return this.admin.tenants(q);
  }

  @Get("tenants/:id")
  tenant(@Param("id") id: string) {
    return this.admin.tenant(id);
  }

  @SuperAdminOnly()
  @HttpCode(204)
  @Post("tenants/:id/extend-trial")
  async extendTrial(@Param("id") id: string, @Body(new ZodPipe(extendTrialSchema)) body: { days: number }) {
    await this.admin.extendTrial(id, body.days);
  }

  @SuperAdminOnly()
  @HttpCode(204)
  @Post("tenants/:id/suspend")
  async suspend(@Param("id") id: string, @Body(new ZodPipe(suspendSchema)) body: { reason: string }) {
    await this.admin.suspend(id, body.reason);
  }

  @SuperAdminOnly()
  @HttpCode(204)
  @Post("tenants/:id/unsuspend")
  async unsuspend(@Param("id") id: string) {
    await this.admin.unsuspend(id);
  }

  @Get("plans")
  plans() {
    return this.admin.plans();
  }

  @SuperAdminOnly()
  @Patch("plans/:code")
  updatePlan(@Param("code") code: string, @Body(new ZodPipe(planUpdateSchema)) body: PlanUpdateInput) {
    return this.admin.updatePlan(code, body);
  }

  @Get("invoices")
  invoices(@Query(new ZodPipe(adminInvoiceQuerySchema)) q: z.infer<typeof adminInvoiceQuerySchema>) {
    return this.admin.invoices(q);
  }

  @SuperAdminOnly()
  @Get("expenses")
  expenses() {
    return this.admin.expenses();
  }

  @SuperAdminOnly()
  @Post("expenses")
  addExpense(@Body(new ZodPipe(expenseSchema)) body: ExpenseInput) {
    return this.admin.addExpense(body);
  }

  @SuperAdminOnly()
  @HttpCode(204)
  @Delete("expenses/:id")
  async deleteExpense(@Param("id") id: string) {
    await this.admin.deleteExpense(id);
  }

  @Get("tickets")
  tickets(@Query("status") status?: string) {
    return this.support.adminList({ status: TICKET_STATUSES.includes(status as TicketStatus) ? (status as TicketStatus) : undefined });
  }

  @Get("tickets/:id")
  ticket(@Param("id") id: string) {
    return this.support.adminGet(id);
  }

  @Post("tickets/:id/messages")
  replyTicket(@Param("id") id: string, @Body(new ZodPipe(ticketMessageSchema)) body: { body: string }) {
    return this.support.adminReply(id, body.body);
  }

  @Patch("tickets/:id")
  updateTicket(@Param("id") id: string, @Body(new ZodPipe(ticketUpdateSchema)) body: z.infer<typeof ticketUpdateSchema>) {
    return this.support.adminUpdate(id, body);
  }

  @Get("system")
  system() {
    return this.admin.system();
  }
}
