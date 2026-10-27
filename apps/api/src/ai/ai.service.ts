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
  complete(system: string, user: string): Promise<{ text: string; model: string }>;
  /** Per-model state for the platform System page */
  status?(): AiModelStatus[];
}

export interface AiModelStatus {
  model: string;
  /** Skipped until then after a limit / outage */
  coolingUntil: string | null;
  lastError: string | null;
  lastOkAt: string | null;
}

/** Free OpenRouter models that write well in Azerbaijani, Russian and English (verified 2026-10-25). */
export const FREE_OPENROUTER_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3.5-lightning:free",
];

const SECOND = 1000;

/** How long a model is skipped after a failure, and whether to try the next one. */
function onFailure(e: unknown): { cooldownMs: number; next: boolean; reason: string } {
  if (e instanceof Anthropic.AuthenticationError) return { cooldownMs: 0, next: false, reason: "invalid API key" };
  if (e instanceof Anthropic.RateLimitError) {
    const after = Number(e.headers?.get?.("retry-after"));
    return { cooldownMs: Number.isFinite(after) && after > 0 ? after * SECOND : 60 * SECOND, next: true, reason: "rate limited" };
  }
  if (e instanceof Anthropic.APIError) {
    const status = e.status ?? 0;
    if (status === 402) return { cooldownMs: 10 * 60 * SECOND, next: true, reason: "no credits" };
    if (status === 403 || status === 404) return { cooldownMs: 60 * 60 * SECOND, next: true, reason: `unavailable (${status})` };
    if (status === 400 || status === 422) return { cooldownMs: 10 * 60 * SECOND, next: true, reason: `rejected the request (${status})` };
    return { cooldownMs: 30 * SECOND, next: true, reason: `provider error (${status || "network"})` };
  }
  if (e instanceof AppError) return { cooldownMs: 0, next: true, reason: e.message };
  return { cooldownMs: 30 * SECOND, next: true, reason: e instanceof Error ? e.message : String(e) };
}

/**
 * Claude (and, through OpenRouter, other models) via the official Anthropic SDK —
 * OpenRouter exposes the same Messages API. Models are tried in order; one that hits
 * a limit, runs out of credit or fails is skipped for a while and the next one answers.
 * Claude models get low effort (short drafting tasks); on Anthropic itself the
 * server-side fallback also keeps a request alive if the model declines it.
 */
export class ChainAiClient implements AiClient {
  private readonly client: Anthropic;
  private readonly state = new Map<string, { coolingUntil: number; lastError: string | null; lastOkAt: number | null }>();

  constructor(
    private readonly kind: "anthropic" | "openrouter",
    apiKey: string,
    private readonly models: string[],
    baseURL = "https://openrouter.ai/api",
  ) {
    this.client =
      kind === "openrouter"
        ? new Anthropic({ baseURL, apiKey: null, authToken: apiKey, timeout: 45_000, maxRetries: 0 })
        : new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
    for (const m of models) this.state.set(m, { coolingUntil: 0, lastError: null, lastOkAt: null });
  }

  private async once(model: string, system: string, user: string): Promise<string> {
    const claude = model.includes("claude");
    const request = {
      model,
      // Thinking models need room for reasoning plus a short answer
      max_tokens: 4096,
      ...(claude ? { output_config: { effort: "low" as const } } : {}),
      system,
      messages: [{ role: "user" as const, content: user }],
    };
    const response =
      this.kind === "anthropic"
        ? await this.client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await this.client.messages.create(request);
    if (response.stop_reason === "refusal") throw new AppError("AI_UNAVAILABLE", "declined the request");
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (!text) throw new AppError("AI_UNAVAILABLE", "returned no text");
    return text;
  }

  async complete(system: string, user: string) {
    const now = Date.now();
    // Models in their cooldown go last instead of being dropped: if everything is
    // cooling down, the soonest-available one still gets a chance
    const order = [...this.models].sort((a, b) => Math.max(0, this.state.get(a)!.coolingUntil - now) - Math.max(0, this.state.get(b)!.coolingUntil - now));
    const tried: string[] = [];
    for (const model of order) {
      const st = this.state.get(model)!;
      if (st.coolingUntil > now && tried.length) continue;
      tried.push(model);
      try {
        const text = await this.once(model, system, user);
        Object.assign(st, { coolingUntil: 0, lastError: null, lastOkAt: Date.now() });
        return { text, model };
      } catch (e) {
        const f = onFailure(e);
        Object.assign(st, { coolingUntil: Date.now() + f.cooldownMs, lastError: f.reason });
        if (!f.next) throw new AppError("AI_UNAVAILABLE", `The AI provider rejected the key (${f.reason})`, { reason: "auth" });
      }
    }
    throw new AppError("AI_UNAVAILABLE", "All AI models are busy or unavailable right now", { reason: "all_busy", tried: tried.length });
  }

  status(): AiModelStatus[] {
    const now = Date.now();
    return this.models.map((model) => {
      const st = this.state.get(model)!;
      return {
        model,
        coolingUntil: st.coolingUntil > now ? new Date(st.coolingUntil).toISOString() : null,
        lastError: st.lastError,
        lastOkAt: st.lastOkAt ? new Date(st.lastOkAt).toISOString() : null,
      };
    });
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
  client: AiClient | null = AiService.fromConfig();

  /** AI_MODELS (comma-separated, tried in order) or AI_MODEL; defaults per provider. */
  private static fromConfig(): AiClient | null {
    const c = config();
    const listed = (c.AI_MODELS ?? c.AI_MODEL ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    if (c.AI_PROVIDER === "openrouter") {
      return c.OPENROUTER_API_KEY ? new ChainAiClient("openrouter", c.OPENROUTER_API_KEY, listed.length ? listed : FREE_OPENROUTER_MODELS) : null;
    }
    return c.ANTHROPIC_API_KEY ? new ChainAiClient("anthropic", c.ANTHROPIC_API_KEY, listed.length ? listed : ["claude-opus-5-5"]) : null;
  }

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
    if (!client) throw new AppError("AI_UNAVAILABLE", "The AI assistant is not configured on this server (ANTHROPIC_API_KEY or OPENROUTER_API_KEY)");
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
      const { text, model } = await client.complete(system, user);
      const usage = await this.prisma.scoped((tx) => this.usage(tx, ctx.tenantId));
      return { text, model, usage };
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
