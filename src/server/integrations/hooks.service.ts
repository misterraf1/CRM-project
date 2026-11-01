import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { WEBHOOK_EVENTS, type WebhookDeliveryDto, type WebhookEndpointDto, type WebhookEvent } from "@/shared";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { afterResponse } from "../common/after-response";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { randomToken } from "../common/ids";
import { JobsMonitor } from "../common/jobs-monitor";
import { config } from "../config";
import type { Database, Tx } from "../db/database";
import type { WebhookDelivery, WebhookEndpoint } from "../db/models";

const BATCH = 50;
const TIMEOUT_MS = 10_000;
/** Waits before the 2nd … 6th attempt; after that the delivery is failed */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
const STUCK_MS = 5 * 60_000;

/** Fields sent for each kind of record (ids and plain values only) */
const FIELDS: Record<string, string[]> = {
  contact: ["id", "type", "name", "email", "phone", "extraPhones", "companyName", "companyId", "stage", "source", "tags", "ownerId", "customFields", "createdAt"],
  deal: ["id", "title", "amount", "currency", "pipelineId", "stageId", "contactId", "ownerId", "expectedClose", "closedAt", "lostReason", "customFields", "createdAt"],
  conversation: ["id", "channelId", "contactId", "status", "assigneeId", "createdAt"],
  task: ["id", "title", "status", "priority", "dueAt", "assigneeId", "contactId", "dealId"],
  salesDoc: ["id", "kind", "number", "status", "contactId", "dealId", "currency", "total", "paid", "issuedAt", "dueAt"],
  order: ["id", "number", "title", "status", "contactId", "dealId", "createdAt"],
  serviceCase: ["id", "number", "title", "status", "priority", "contactId", "createdAt"],
};

/** Private and local addresses are never called (the server must not be steered into its own network). */
function privateHost(host: string) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (isIP(h) === 4) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(h) === 6) return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
  return false;
}

/**
 * Outgoing webhooks: a company's own systems (or Zapier, Make, n8n) are told when
 * something happens. Events are queued inside the change's transaction (outbox), sent
 * right after commit and retried with back-off; each request is signed:
 *   X-Axis-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<body>")
 */
export class HooksService {
  private draining?: Promise<number>;
  private sweep?: NodeJS.Timeout;

  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly monitor: JobsMonitor,
  ) {}

  /** Retries come due over hours: a long-running server checks every minute (serverless: /api/cron) */
  start() {
    this.monitor.register("webhooks");
    if (!config().JOBS_ENABLED) return;
    this.sweep = setInterval(() => void this.monitor.track("webhooks", () => this.drain()), 60_000);
  }

  stop() {
    clearInterval(this.sweep);
  }

  // ─── Endpoints ──────────────────────────────────────────────

  async list(): Promise<WebhookEndpointDto[]> {
    const ctx = authedContext();
    const rows = await this.db.read((tx) => tx.webhookEndpoint.find({ tenantId: ctx.tenantId }, { sort: { createdAt: -1 } }));
    return rows.map(toDto);
  }

  async create(input: { url: string; events: WebhookEvent[]; description?: string }): Promise<WebhookEndpointDto> {
    const ctx = authedContext();
    const url = checkUrl(input.url);
    return this.db.scoped(async (tx) => {
      if ((await tx.webhookEndpoint.count({ tenantId: ctx.tenantId })) >= 20) throw new AppError("CONFLICT", "At most 20 webhooks");
      const row = await tx.webhookEndpoint.insertOne({ tenantId: ctx.tenantId, url, events: [...new Set(input.events)], secret: `whsec_${randomToken(24)}`, description: input.description || null, createdById: ctx.membershipId });
      await this.audit.log(tx, { action: "webhook.created", entityType: "webhook", entityId: row.id, diff: { url, events: row.events } });
      return toDto(row);
    });
  }

  async update(id: string, input: { url?: string; events?: WebhookEvent[]; description?: string | null; active?: boolean }): Promise<WebhookEndpointDto> {
    const ctx = authedContext();
    const set: Partial<WebhookEndpoint> = {
      ...(input.url ? { url: checkUrl(input.url) } : {}),
      ...(input.events ? { events: [...new Set(input.events)] } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    };
    return this.db.scoped(async (tx) => {
      const row = await tx.webhookEndpoint.findOneAndUpdate({ id, tenantId: ctx.tenantId }, { $set: set });
      if (!row) throw notFound("Webhook");
      await this.audit.log(tx, { action: "webhook.updated", entityType: "webhook", entityId: id, diff: JSON.parse(JSON.stringify(set)) });
      return toDto(row);
    });
  }

  async remove(id: string): Promise<WebhookEndpointDto[]> {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const res = await tx.webhookEndpoint.deleteMany({ id, tenantId: ctx.tenantId });
      if (!res.count) throw notFound("Webhook");
      await tx.webhookDelivery.deleteMany({ tenantId: ctx.tenantId, endpointId: id });
      await this.audit.log(tx, { action: "webhook.deleted", entityType: "webhook", entityId: id });
    });
    return this.list();
  }

  async deliveries(id: string): Promise<WebhookDeliveryDto[]> {
    const ctx = authedContext();
    const rows = await this.db.read(async (tx) => {
      if (!(await tx.webhookEndpoint.count({ id, tenantId: ctx.tenantId }))) throw notFound("Webhook");
      return tx.webhookDelivery.find({ tenantId: ctx.tenantId, endpointId: id }, { sort: { createdAt: -1 }, limit: 50 });
    });
    return rows.map((d) => ({
      id: d.id,
      event: d.event,
      status: d.status,
      attempts: d.attempts,
      responseStatus: d.responseStatus,
      error: d.error,
      createdAt: d.createdAt.toISOString(),
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
    }));
  }

  /** A "ping" sent at once, so the company can check its receiver; the answer is shown right away. */
  async test(id: string): Promise<WebhookDeliveryDto> {
    const ctx = authedContext();
    const endpoint = await this.db.read((tx) => tx.webhookEndpoint.findOne({ id, tenantId: ctx.tenantId }));
    if (!endpoint) throw notFound("Webhook");
    const delivery = await this.db.scoped((tx) => tx.webhookDelivery.insertOne({ tenantId: ctx.tenantId, endpointId: id, event: "ping", payload: { message: "Axis webhook test" }, nextAttemptAt: new Date() }));
    await this.attempt(delivery, endpoint, { final: true });
    return (await this.deliveries(id)).find((d) => d.id === delivery.id)!;
  }

  // ─── Queue and delivery ─────────────────────────────────────

  /** Inside the change's transaction: one delivery per active endpoint listening for the event. */
  async enqueue(tx: Tx, tenantId: string, event: string, payload: Record<string, unknown>) {
    if (!(WEBHOOK_EVENTS as readonly string[]).includes(event)) return;
    const endpoints = await tx.webhookEndpoint.find({ tenantId, active: true, events: event }, { projection: { id: 1 } });
    if (!endpoints.length) return;
    await tx.webhookDelivery.insertMany(endpoints.map((e) => ({ tenantId, endpointId: e.id, event, payload: payload as WebhookDelivery["payload"], nextAttemptAt: new Date() })));
    if (config().JOBS_ENABLED) afterResponse(() => this.monitor.track("webhooks", () => this.drain()));
  }

  /** Sends what is due; concurrent calls share one pass. */
  drain(): Promise<number> {
    this.draining ??= this.drainOnce().finally(() => (this.draining = undefined));
    return this.draining;
  }

  private async drainOnce(): Promise<number> {
    const deliveries = this.db.system.webhookDelivery;
    await deliveries.updateMany({ status: "processing", nextAttemptAt: { $lt: new Date(Date.now() - STUCK_MS) } }, { $set: { status: "pending" } });
    let sent = 0;
    for (;;) {
      const batch = await deliveries.find({ status: "pending", nextAttemptAt: { $lte: new Date() } }, { sort: { nextAttemptAt: 1 }, limit: BATCH });
      if (!batch.length) return sent;
      for (const d of batch) {
        const claimed = await deliveries.updateMany({ id: d.id, status: "pending" }, { $set: { status: "processing", nextAttemptAt: new Date() } });
        if (!claimed.count) continue;
        const endpoint = await this.db.system.webhookEndpoint.findOne({ id: d.endpointId, tenantId: d.tenantId });
        if (!endpoint || !endpoint.active) {
          await deliveries.update({ id: d.id }, { $set: { status: "failed", error: "Webhook removed or switched off" } });
          continue;
        }
        await this.attempt(d, endpoint);
        sent += 1;
      }
    }
  }

  private async attempt(d: WebhookDelivery, endpoint: WebhookEndpoint, { final = false } = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const data = d.event === "ping" ? d.payload : await this.snapshot(d.tenantId, d.payload as Record<string, string>);
    const body = JSON.stringify({ id: d.id, event: d.event, createdAt: d.createdAt.toISOString(), data });
    const signature = createHmac("sha256", endpoint.secret).update(`${timestamp}.${body}`).digest("hex");
    let status: number | null = null;
    let error: string | null = null;
    try {
      checkUrl(endpoint.url);
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Axis-Webhooks/1.0", "x-axis-event": d.event, "x-axis-delivery": d.id, "x-axis-timestamp": String(timestamp), "x-axis-signature": `sha256=${signature}` },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      await res.body?.cancel().catch(() => undefined);
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof AppError ? e.message : e instanceof Error ? (e.name === "TimeoutError" ? "Timed out" : e.message).slice(0, 200) : "Failed";
    }
    const attempts = d.attempts + 1;
    const ok = !error;
    const retry = !ok && !final && attempts <= BACKOFF_MS.length;
    await this.db.system.webhookDelivery.update(
      { id: d.id },
      { $set: { status: ok ? "success" : retry ? "pending" : "failed", attempts, responseStatus: status, error, deliveredAt: ok ? new Date() : null, nextAttemptAt: new Date(Date.now() + (retry ? BACKOFF_MS[attempts - 1]! : 0)) } },
    );
    await this.db.system.webhookEndpoint.updateMany({ id: endpoint.id, tenantId: endpoint.tenantId }, { $set: { lastDeliveryAt: new Date(), lastStatus: ok ? "success" : "failed" } });
  }

  /** The record the event is about, as it is now (sent with its ids so the receiver can fetch more via the API). */
  private async snapshot(tenantId: string, payload: Record<string, string>) {
    const refs: [string, keyof Tx, string | undefined][] = [
      ["contact", "contact", payload.contactId],
      ["deal", "deal", payload.dealId],
      ["conversation", "conversation", payload.conversationId],
      ["task", "task", payload.taskId],
      ["document", "salesDoc", payload.docId],
      ["order", "order", payload.orderId],
      ["case", "serviceCase", payload.caseId],
    ];
    const out: Record<string, unknown> = { ...payload };
    for (const [name, model, id] of refs) {
      if (!id) continue;
      const repo = this.db.system[model] as unknown as { findOne(q: object): Promise<Record<string, unknown> | null> };
      const row = await repo.findOne({ id, tenantId });
      if (row) out[name] = Object.fromEntries((FIELDS[model as string] ?? ["id"]).filter((f) => f in row).map((f) => [f, row[f]]));
    }
    return out;
  }
}

/** https only (http too when the server allows it, e.g. tests), never a private address. */
function checkUrl(raw: string) {
  const parsed = z.string().url().safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", "Invalid URL", { url: ["invalid"] });
  const url = new URL(parsed.data);
  const allowPrivate = config().WEBHOOKS_ALLOW_PRIVATE;
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) throw new AppError("VALIDATION_FAILED", "Webhooks need an https address", { url: ["https"] });
  if (!allowPrivate && privateHost(url.hostname)) throw new AppError("VALIDATION_FAILED", "Private addresses are not allowed", { url: ["private"] });
  if (url.username || url.password) throw new AppError("VALIDATION_FAILED", "No credentials in the URL", { url: ["invalid"] });
  return url.toString();
}

function toDto(e: WebhookEndpoint): WebhookEndpointDto {
  return {
    id: e.id,
    url: e.url,
    events: e.events as WebhookEvent[],
    description: e.description,
    active: e.active,
    secret: e.secret,
    lastDeliveryAt: e.lastDeliveryAt?.toISOString() ?? null,
    lastStatus: e.lastStatus,
    createdAt: e.createdAt.toISOString(),
  };
}
