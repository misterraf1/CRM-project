import { Body, Controller, Get, HttpCode, Post, Query, Req } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { Public } from "../common/decorators";
import { AppError } from "../common/errors";
import { WebhooksService } from "./webhooks.service";

@Controller("v1/webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /** Meta's subscription handshake. */
  @Public()
  @SkipThrottle()
  @Get("meta")
  verify(@Query() q: Record<string, string>) {
    const token = config().META_VERIFY_TOKEN;
    if (!token || q["hub.mode"] !== "subscribe" || q["hub.verify_token"] !== token) throw new AppError("FORBIDDEN", "Verification failed");
    return q["hub.challenge"] ?? "";
  }

  /** Deliveries are accepted only with a valid X-Hub-Signature-256 over the raw body. */
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post("meta")
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    const secret = config().META_APP_SECRET;
    const raw = req.rawBody;
    const header = req.get("x-hub-signature-256") ?? "";
    if (!secret || !raw) throw new AppError("FORBIDDEN", "Webhooks are not configured");
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
    const given = Buffer.from(header);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AppError("FORBIDDEN", "Invalid signature");
    return this.webhooks.processMeta(raw, body as Parameters<WebhooksService["processMeta"]>[1]);
  }
}
