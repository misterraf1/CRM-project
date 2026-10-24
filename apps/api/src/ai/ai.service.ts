import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import type { AiTextDto } from "@axis/shared";
import { config } from "../config";
import { authedContext } from "../common/context";
import { AppError } from "../common/errors";
import { PrismaService, type Tx } from "../prisma/prisma.service";

const METRIC = "ai_credits";

/** The one call the assistant needs; replaceable in tests. */
export interface AiClient {
  complete(system: string, user: string): Promise<string>;
}

/**
 * Claude via the official SDK. Low effort: these are short drafting tasks. The
 * server-side fallback keeps a request alive if the main model declines it.
 */
class AnthropicAiClient implements AiClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  }

  async complete(system: string, user: string): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: config().AI_MODEL,
      // Thinking is always on for this model; leave room for it plus a short answer
      max_tokens: 4096,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") throw new AppError("AI_UNAVAILABLE", "The assistant declined this request", { reason: "refusal" });
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (!text) throw new AppError("AI_UNAVAILABLE", "The assistant returned no text");
    return text;
  }
}

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * Metered access to the assistant: each request takes one credit from the plan's
 * monthly allowance (Plan.aiCredits); a failed request gives it back.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger("AI");
  client: AiClient | null = config().ANTHROPIC_API_KEY ? new AnthropicAiClient(config().ANTHROPIC_API_KEY!) : null;

  get available() {
    return this.client !== null;
  }

  async usage(tx: Tx, tenantId: string): Promise<{ used: number; limit: number }> {
    const [sub, counter] = await Promise.all([
      tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
      tx.usageCounter.findUnique({ where: { tenantId_metric_period: { tenantId, metric: METRIC, period: monthStart() } } }),
    ]);
    return { used: counter?.value ?? 0, limit: sub?.plan.aiCredits ?? 0 };
  }

  /** Takes a credit (atomically, so parallel requests can't overspend), runs `fn`, refunds on failure. */
  async run(system: string, user: string): Promise<AiTextDto> {
    const ctx = authedContext();
    const client = this.client;
    if (!client) throw new AppError("AI_UNAVAILABLE", "The AI assistant is not configured on this server (ANTHROPIC_API_KEY)");
    const period = monthStart();
    const key = { tenantId_metric_period: { tenantId: ctx.tenantId, metric: METRIC, period } };
    const { limit } = await this.prisma.scoped((tx) => this.usage(tx, ctx.tenantId));
    await this.prisma.scoped(async (tx) => {
      await tx.usageCounter.upsert({ where: key, create: { tenantId: ctx.tenantId, metric: METRIC, period, value: 0 }, update: {} });
      const taken = await tx.usageCounter.updateMany({ where: { tenantId: ctx.tenantId, metric: METRIC, period, value: { lt: limit } }, data: { value: { increment: 1 } } });
      if (!taken.count) {
        const used = (await tx.usageCounter.findUnique({ where: key }))?.value ?? 0;
        throw new AppError("AI_LIMIT", "This month's AI allowance is used up", { used, limit });
      }
    });
    try {
      const text = await client.complete(system, user);
      const usage = await this.prisma.scoped((tx) => this.usage(tx, ctx.tenantId));
      return { text, usage };
    } catch (e) {
      await this.prisma.scoped((tx) => tx.usageCounter.updateMany({ where: { tenantId: ctx.tenantId, metric: METRIC, period }, data: { value: { decrement: 1 } } }));
      if (e instanceof AppError) throw e;
      if (e instanceof Anthropic.RateLimitError) throw new AppError("AI_UNAVAILABLE", "The assistant is busy, try again in a minute", { reason: "rate_limited" });
      if (e instanceof Anthropic.APIError) {
        this.logger.error(`Claude API ${e.status}: ${e.message}`);
        throw new AppError("AI_UNAVAILABLE", "The assistant is unavailable right now", { reason: "api_error" });
      }
      throw e;
    }
  }

  constructor(private readonly prisma: PrismaService) {}
}
