import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { addonsSchema, checkoutSchema, demoCompleteSchema, demoNextChargeSchema, downgradeSchema, type AddonsInput, type CheckoutInput } from "@axis/shared";
import type { z } from "zod";
import { authedContext } from "../common/context";
import { AllowInactive, RequirePermission } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { BillingJob } from "./billing.job";
import { BillingService } from "./billing.service";

// Owners only; usable while suspended so a company can always pay to reactivate.
@AllowInactive()
@RequirePermission("billing.manage")
@Controller("v1/billing")
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly job: BillingJob,
  ) {}

  @Get()
  overview() {
    return this.billing.overview();
  }

  @Post("checkout")
  checkout(@Body(new ZodPipe(checkoutSchema)) body: CheckoutInput) {
    return this.billing.checkout(body);
  }

  @Get("invoices/:id")
  invoice(@Param("id") id: string) {
    return this.billing.invoice(id);
  }

  @Post("invoices/:id/pay")
  pay(@Param("id") id: string) {
    return this.billing.pay(id);
  }

  @HttpCode(204)
  @Post("downgrade")
  downgrade(@Body(new ZodPipe(downgradeSchema)) body: z.infer<typeof downgradeSchema>) {
    return this.billing.downgrade(body.planCode);
  }

  @HttpCode(204)
  @Delete("downgrade")
  cancelDowngrade() {
    return this.billing.cancelDowngrade();
  }

  @HttpCode(204)
  @Post("cancel")
  cancel() {
    return this.billing.setCancelAtPeriodEnd(true);
  }

  @HttpCode(204)
  @Post("resume")
  resume() {
    return this.billing.setCancelAtPeriodEnd(false);
  }

  @Post("addons")
  addons(@Body(new ZodPipe(addonsSchema)) body: AddonsInput) {
    return this.billing.addons(body);
  }

  // ── Demo provider controls ──
  @HttpCode(200)
  @Post("demo/invoices/:id/complete")
  demoComplete(@Param("id") id: string, @Body(new ZodPipe(demoCompleteSchema)) body: z.infer<typeof demoCompleteSchema>) {
    return this.billing.demoComplete(id, body.outcome);
  }

  @HttpCode(204)
  @Post("demo/next-charge")
  demoNextCharge(@Body(new ZodPipe(demoNextChargeSchema)) body: z.infer<typeof demoNextChargeSchema>) {
    return this.billing.demoNextCharge(body.fails);
  }

  @Post("demo/advance")
  async demoAdvance() {
    await this.job.demoAdvance(authedContext().tenantId);
    return this.billing.overview();
  }
}
