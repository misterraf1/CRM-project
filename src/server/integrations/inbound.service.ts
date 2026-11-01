import { createHmac, timingSafeEqual } from "node:crypto";
import { CURRENCIES, INBOUND_NEEDS_SECRET, type InboundHookDto, type InboundKind } from "@/shared";
import type { z } from "zod";
import type { inboundCreateSchema, inboundUpdateSchema } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { AutomationRunner } from "../automations/automation.runner";
import { EntitlementsService } from "../billing/entitlements.service";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { randomToken } from "../common/ids";
import { config } from "../config";
import { ActivityService } from "../crm/activity.service";
import { normalizePhone, parseNumber } from "../crm/data-files";
import type { Database, Tx } from "../db/database";
import type { Contact, InboundHook } from "../db/models";
import { NotificationsService } from "../notifications/notifications.service";

const SEEN_KEEP = 200;
const pick = (o: Record<string, string>, ...keys: string[]) => keys.map((k) => o[k]).find((v) => v && v.trim())?.trim();

/** Keys lowercased, nested objects flattened one level ("billing.phone"), values as text. */
function flat(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (o: unknown, prefix: string) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      const key = `${prefix}${k}`.toLowerCase();
      if (v !== null && typeof v === "object" && !Array.isArray(v) && !prefix) walk(v, `${key}.`);
      else if (v !== null && v !== undefined && typeof v !== "object") out[key] = String(v);
    }
  };
  walk(input, "");
  return out;
}

const hmacBase64 = (secret: string, raw: Buffer) => createHmac("sha256", secret).update(raw).digest("base64");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

interface Lead {
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  comment: string | null;
  utm: Record<string, string>;
  source: "website" | "ads" | "phone";
  externalId?: string;
}

/**
 * Incoming integrations: website forms, Google Ads lead forms, shop orders and phone
 * calls arrive at a company's secret address and become customers, deals, call
 * records and notifications — the same records a member would create by hand.
 */
export class InboundService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly automations: AutomationRunner,
    private readonly entitlements: EntitlementsService,
  ) {}

  // ─── Settings ───────────────────────────────────────────────

  async list(): Promise<InboundHookDto[]> {
    const ctx = authedContext();
    const rows = await this.db.read((tx) => tx.inboundHook.find({ tenantId: ctx.tenantId }, { sort: { createdAt: -1 } }));
    return rows.map(toDto);
  }

  async create(input: z.infer<typeof inboundCreateSchema>): Promise<InboundHookDto> {
    const ctx = authedContext();
    if (INBOUND_NEEDS_SECRET.includes(input.kind) && !input.secret) throw new AppError("VALIDATION_FAILED", "A secret is required", { secret: ["required"] });
    return this.db.scoped(async (tx) => {
      if ((await tx.inboundHook.count({ tenantId: ctx.tenantId })) >= 30) throw new AppError("CONFLICT", "At most 30 incoming integrations");
      if (input.ownerId) await this.checkMember(tx, ctx.tenantId, input.ownerId);
      const row = await tx.inboundHook.insertOne({
        tenantId: ctx.tenantId,
        kind: input.kind,
        name: input.name,
        token: randomToken(24),
        secret: input.secret || null,
        ownerId: input.ownerId ?? null,
        createDeal: input.createDeal,
        createdById: ctx.membershipId,
      });
      await this.audit.log(tx, { action: "inbound.created", entityType: "inbound_hook", entityId: row.id, diff: { kind: input.kind, name: input.name } });
      return toDto(row);
    });
  }

  async update(id: string, input: z.infer<typeof inboundUpdateSchema>): Promise<InboundHookDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      if (input.ownerId) await this.checkMember(tx, ctx.tenantId, input.ownerId);
      const set: Partial<InboundHook> = {
        ...(input.name ? { name: input.name } : {}),
        ...(input.secret ? { secret: input.secret } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.createDeal !== undefined ? { createDeal: input.createDeal } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      };
      const row = await tx.inboundHook.findOneAndUpdate({ id, tenantId: ctx.tenantId }, { $set: set });
      if (!row) throw notFound("Integration");
      await this.audit.log(tx, { action: "inbound.updated", entityType: "inbound_hook", entityId: id, diff: { name: input.name ?? null, active: input.active ?? null } });
      return toDto(row);
    });
  }

  async remove(id: string): Promise<InboundHookDto[]> {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const res = await tx.inboundHook.deleteMany({ id, tenantId: ctx.tenantId });
      if (!res.count) throw notFound("Integration");
      await this.audit.log(tx, { action: "inbound.deleted", entityType: "inbound_hook", entityId: id });
    });
    return this.list();
  }

  private async checkMember(tx: Tx, tenantId: string, id: string) {
    if (!(await tx.membership.count({ id, tenantId, status: "ACTIVE" }))) throw new AppError("VALIDATION_FAILED", "Unknown member", { ownerId: ["unknown"] });
  }

  // ─── Receiving ──────────────────────────────────────────────

  /** POST /v1/public/in/<tenant>.<token>: what the outside system sends. */
  async receive(address: string, req: Request, raw: Buffer): Promise<{ ok: true; ignored?: string }> {
    const [tenantId, token] = address.split(".");
    if (!tenantId || !token) throw notFound("Integration");
    const hook = await this.db.read((tx) => tx.inboundHook.findOne({ tenantId, token, active: true }), { tenantId });
    if (!hook) throw notFound("Integration");
    const body = parseBody(req.headers.get("content-type") ?? "", raw);
    try {
      const result = await this.handle(hook, req, raw, body);
      await this.db.system.inboundHook.updateMany({ id: hook.id, tenantId }, { $inc: { received: result.ignored ? 0 : 1 }, $set: { lastReceivedAt: new Date(), lastError: null } });
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 200) : "Failed";
      await this.db.system.inboundHook.updateMany({ id: hook.id, tenantId }, { $set: { lastError: message, lastReceivedAt: new Date() } });
      throw e;
    }
  }

  private async handle(hook: InboundHook, req: Request, raw: Buffer, body: unknown): Promise<{ ok: true; ignored?: string }> {
    const f = flat(body);
    switch (hook.kind as InboundKind) {
      case "leads": {
        // Tilda checks a new address with "test=test"; WooCommerce-style pings have no fields
        if (f.test === "test" && Object.keys(f).length <= 2) return { ok: true, ignored: "test" };
        return this.lead(hook, leadFrom(f, "website"));
      }
      case "google_ads": {
        if (!hook.secret || !same(f.google_key ?? "", hook.secret)) throw new AppError("FORBIDDEN", "Wrong google_key");
        const columns = Array.isArray((body as { user_column_data?: unknown }).user_column_data) ? ((body as { user_column_data: { column_id?: string; string_value?: string }[] }).user_column_data) : [];
        const col = (id: string) => columns.find((c) => c.column_id === id)?.string_value?.trim() || null;
        const name = col("FULL_NAME") ?? ([col("FIRST_NAME"), col("LAST_NAME")].filter(Boolean).join(" ") || null);
        const utm = Object.fromEntries(Object.entries({ utm_campaign: f.campaign_id, google_form: f.form_id }).filter(([, v]) => v)) as Record<string, string>;
        return this.lead(hook, { name, phone: col("PHONE_NUMBER"), email: col("EMAIL"), company: col("COMPANY_NAME"), comment: null, utm, source: "ads", externalId: f.lead_id ? `g:${f.lead_id}` : undefined });
      }
      case "shopify": {
        const given = req.headers.get("x-shopify-hmac-sha256") ?? "";
        if (!hook.secret || !same(given, hmacBase64(hook.secret, raw))) throw new AppError("FORBIDDEN", "Bad signature");
        const topic = req.headers.get("x-shopify-topic") ?? "orders/create";
        if (!topic.startsWith("orders/")) return { ok: true, ignored: topic };
        return this.order(hook, {
          id: f.id,
          number: f.name ?? (f.order_number ? `#${f.order_number}` : f.id),
          name: [f["customer.first_name"], f["customer.last_name"]].filter(Boolean).join(" ") || [f["billing_address.first_name"], f["billing_address.last_name"]].filter(Boolean).join(" ") || null,
          email: f.email ?? f["customer.email"] ?? null,
          phone: f.phone ?? f["customer.phone"] ?? f["billing_address.phone"] ?? null,
          total: f.total_price,
          currency: f.currency,
          shop: "Shopify",
        });
      }
      case "woocommerce": {
        // Saving a webhook in WooCommerce sends an unsigned ping ("webhook_id=…")
        if (f.webhook_id && Object.keys(f).length === 1) return { ok: true, ignored: "ping" };
        const given = req.headers.get("x-wc-webhook-signature") ?? "";
        if (!hook.secret || !same(given, hmacBase64(hook.secret, raw))) throw new AppError("FORBIDDEN", "Bad signature");
        return this.order(hook, {
          id: f.id,
          number: f.number ? `#${f.number}` : f.id,
          name: [f["billing.first_name"], f["billing.last_name"]].filter(Boolean).join(" ") || null,
          email: f["billing.email"] ?? null,
          phone: f["billing.phone"] ?? null,
          total: f.total,
          currency: f.currency,
          shop: "WooCommerce",
        });
      }
      case "calls":
        return this.call(hook, f);
    }
  }

  /** A form or ad lead: a new customer (or a note on the existing one), optionally a deal, and a notice. */
  private async lead(hook: InboundHook, lead: Lead): Promise<{ ok: true; ignored?: string }> {
    if (!lead.phone && !lead.email) throw new AppError("VALIDATION_FAILED", "A phone or email is required", { phone: ["required"] });
    return this.db.scoped(
      async (tx) => {
        if (lead.externalId && (await this.seen(tx, hook, lead.externalId))) return { ok: true as const, ignored: "duplicate" };
        const { contact, created } = await this.findOrCreate(tx, hook, lead);
        const values = Object.fromEntries(Object.entries({ name: lead.name, phone: lead.phone, email: lead.email, company: lead.company, comment: lead.comment, ...lead.utm }).filter(([, v]) => v)) as Record<string, string>;
        await this.activity.record(tx, { tenantId: hook.tenantId, type: "form_submitted", contactId: contact.id, payload: { title: hook.name, values, page: null } });
        if (hook.createDeal && !(!created && (await tx.deal.count({ tenantId: hook.tenantId, contactId: contact.id, closedAt: null })))) {
          await this.deal(tx, hook, contact, `${hook.name}: ${contact.name}`, 0, null, false);
        }
        await this.notifications.notify(tx, hook.tenantId, [contact.ownerId], "form_submission", { contactId: contact.id, title: `${hook.name}: ${contact.name}` });
        return { ok: true as const };
      },
      { tenantId: hook.tenantId },
    );
  }

  /** A shop order: the customer, and a won deal with the order's total. */
  private async order(hook: InboundHook, o: { id?: string; number?: string; name: string | null; email: string | null; phone: string | null; total?: string; currency?: string; shop: string }) {
    return this.db.scoped(
      async (tx) => {
        if (o.id && (await this.seen(tx, hook, `o:${o.id}`))) return { ok: true as const, ignored: "duplicate" };
        const { contact } = await this.findOrCreate(tx, hook, { name: o.name, phone: o.phone, email: o.email, company: null, comment: null, utm: {}, source: "website" });
        const amount = o.total ? Math.round(parseNumber(o.total) * 100) : 0;
        const title = `${o.shop} ${o.number ?? ""}`.trim();
        await this.deal(tx, hook, contact, title, Number.isFinite(amount) ? amount : 0, o.currency ?? null, true);
        await this.notifications.notify(tx, hook.tenantId, [contact.ownerId], "automation", { contactId: contact.id, title: `${title}: ${contact.name}` });
        return { ok: true as const };
      },
      { tenantId: hook.tenantId },
    );
  }

  /** A finished call from the PBX: logged on the customer's card; a missed incoming call is a task-worthy notice. */
  private async call(hook: InboundHook, f: Record<string, string>) {
    // Zadarma and similar send start and end events; only the end carries the outcome
    if (f.event && !/end|hangup|completed/i.test(f.event)) return { ok: true as const, ignored: f.event };
    const direction = /^(out|outgoing|outbound)$/i.test(f.direction ?? "") || f.event === "NOTIFY_OUT_END" ? "out" : "in";
    const other = direction === "in" ? pick(f, "from", "caller", "caller_id", "callerid", "src") : pick(f, "to", "callee", "called", "destination", "dst");
    const phone = other ? normalizePhone(other) : null;
    if (!phone) throw new AppError("VALIDATION_FAILED", "A phone number is required", { from: ["required"] });
    const duration = Math.max(0, Math.round(parseNumber(pick(f, "duration", "billsec", "talk_time") ?? "0")) || 0);
    const status = (pick(f, "status", "disposition", "result") ?? (duration > 0 ? "answered" : "missed")).toLowerCase();
    const outcome = /busy/.test(status) ? "busy" : /answer(ed)?$|^ok|completed|success/.test(status) && duration > 0 ? "done" : "no_answer";
    const externalId = pick(f, "call_id", "pbx_call_id", "id", "uniqueid");
    return this.db.scoped(
      async (tx) => {
        if (externalId && (await this.seen(tx, hook, `c:${externalId}`))) return { ok: true as const, ignored: "duplicate" };
        const { contact } = await this.findOrCreate(tx, hook, { name: null, phone, email: null, company: null, comment: null, utm: {}, source: "phone" });
        const ownerId = contact.ownerId ?? (await this.defaultOwner(tx, hook));
        const endAt = new Date();
        const ev = await tx.calendarEvent.insertOne({
          tenantId: hook.tenantId,
          title: contact.name,
          kind: "call",
          startAt: new Date(endAt.getTime() - duration * 1000),
          endAt,
          contactId: contact.id,
          dealId: null,
          ownerId: ownerId!,
          outcome,
          outcomeNote: pick(f, "recording", "recording_url", "recordingurl", "record") ?? null,
          direction,
          createdById: ownerId!,
        });
        await this.activity.record(tx, {
          tenantId: hook.tenantId,
          type: "call_logged",
          contactId: contact.id,
          payload: { eventId: ev.id, outcome, direction, durationMin: Math.round(duration / 60), note: ev.outcomeNote },
        });
        await tx.contact.updateMany({ id: contact.id, tenantId: hook.tenantId }, { $set: { lastActivityAt: endAt, inactiveAlertedAt: null } });
        if (direction === "in" && outcome !== "done") await this.notifications.notify(tx, hook.tenantId, [ownerId], "automation", { contactId: contact.id, title: `${hook.name}: ${contact.name} (${phone})` });
        return { ok: true as const };
      },
      { tenantId: hook.tenantId },
    );
  }

  // ─── Shared steps ───────────────────────────────────────────

  /** Remembers an external id; true when it was already handled (providers retry). */
  private async seen(tx: Tx, hook: InboundHook, id: string) {
    const res = await tx.inboundHook.updateMany({ id: hook.id, tenantId: hook.tenantId, seen: { $ne: id } }, { $push: { seen: { $each: [id], $slice: -SEEN_KEEP } } });
    return res.count === 0;
  }

  private async defaultOwner(tx: Tx, hook: InboundHook) {
    if (hook.ownerId && (await tx.membership.count({ id: hook.ownerId, tenantId: hook.tenantId, status: "ACTIVE" }))) return hook.ownerId;
    return (await tx.membership.findOne({ tenantId: hook.tenantId, role: "OWNER", status: "ACTIVE" }, { projection: { id: 1 } }))?.id ?? null;
  }

  /** The customer by email or any of their numbers, else a new lead. */
  private async findOrCreate(tx: Tx, hook: InboundHook, lead: Lead): Promise<{ contact: Contact; created: boolean }> {
    const tenantId = hook.tenantId;
    const email = lead.email?.toLowerCase().trim() || null;
    const phone = lead.phone ? (normalizePhone(lead.phone) ?? lead.phone.replace(/[^\d+]/g, "")) : null;
    const tail = phone?.replace(/\D/g, "").slice(-9);
    const or = [...(email ? [{ email }] : []), ...(tail && tail.length >= 7 ? [{ phone: { $regex: `${tail}$` } }, { extraPhones: { $regex: `${tail}$` } }] : [])];
    const existing = or.length ? await tx.contact.findOne({ tenantId, deletedAt: null, $or: or }) : null;
    if (existing) return { contact: existing, created: false };
    await this.entitlements.assertCapacity(tx, tenantId, "contacts");
    const contact = await tx.contact.insertOne({
      tenantId,
      type: "person",
      name: (lead.name || email || phone || "—").slice(0, 150),
      email,
      phone,
      companyName: lead.company?.slice(0, 150) ?? null,
      stage: "LEAD",
      source: lead.source,
      tags: lead.utm.utm_campaign ? [lead.utm.utm_campaign.slice(0, 40)] : [],
      customFields: {},
      ownerId: await this.defaultOwner(tx, hook),
      lastActivityAt: new Date(),
    });
    await this.activity.record(tx, { tenantId, type: "contact_created", contactId: contact.id, payload: { contactName: contact.name } });
    await this.automations.enqueue(tx, tenantId, "contact.created", { contactId: contact.id });
    return { contact, created: true };
  }

  private async deal(tx: Tx, hook: InboundHook, contact: Contact, title: string, amount: number, rawCurrency: string | null, won: boolean) {
    const tenantId = hook.tenantId;
    const pipeline = (await tx.pipeline.findOne({ tenantId, isDefault: true })) ?? (await tx.pipeline.findOne({ tenantId }));
    if (!pipeline) return;
    const stage = await tx.pipelineStage.findOne({ tenantId, pipelineId: pipeline.id, kind: won ? "won" : "open" }, { sort: { order: 1 } });
    if (!stage) return;
    const tenant = await tx.tenant.get({ id: tenantId }, { projection: { currency: 1, fxRates: 1 } });
    const code = rawCurrency?.toUpperCase() ?? tenant.currency;
    // An order in a currency without a company rate is kept in that currency at face value
    const currency = (CURRENCIES as readonly string[]).includes(code) ? code : tenant.currency;
    const baseAmount = currency === tenant.currency ? amount : tenant.fxRates?.[currency] ? Math.round(amount * tenant.fxRates[currency]!) : amount;
    const last = await tx.deal.findOne({ tenantId, stageId: stage.id }, { sort: { position: -1 }, projection: { position: 1 } });
    const deal = await tx.deal.insertOne({
      tenantId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      title: title.slice(0, 150),
      amount,
      currency,
      baseAmount,
      customFields: {},
      contactId: contact.id,
      ownerId: contact.ownerId,
      expectedClose: null,
      closedAt: won ? new Date() : null,
      position: (last?.position ?? 0) + 1024,
    });
    await this.activity.record(tx, { tenantId, type: "deal_created", contactId: contact.id, dealId: deal.id, payload: { dealTitle: deal.title, amount } });
    await this.automations.enqueue(tx, tenantId, "deal.created", { dealId: deal.id });
    if (won) await tx.contact.updateMany({ id: contact.id, tenantId, stage: { $ne: "CUSTOMER" } }, { $set: { stage: "CUSTOMER" } });
  }
}

/** JSON, or form fields (Tilda, Contact Form 7, Zadarma). */
function parseBody(contentType: string, raw: Buffer): unknown {
  const text = raw.toString("utf8");
  if (contentType.includes("json") || /^\s*[{[]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError("VALIDATION_FAILED", "Malformed JSON body");
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/** A lead from whatever a form builder calls its fields. */
function leadFrom(f: Record<string, string>, source: Lead["source"]): Lead {
  const first = pick(f, "first_name", "firstname", "first-name", "ad");
  const last = pick(f, "last_name", "lastname", "last-name", "soyad");
  return {
    name: pick(f, "name", "fio", "fullname", "full_name", "your-name", "ad soyad", "имя", "ad_soyad") ?? ([first, last].filter(Boolean).join(" ") || null),
    phone: pick(f, "phone", "tel", "telephone", "mobile", "phone_number", "your-phone", "telefon", "телефон", "nomre", "nömrə") ?? null,
    email: pick(f, "email", "e-mail", "your-email", "mail", "почта") ?? null,
    company: pick(f, "company", "şirkət", "organization", "компания") ?? null,
    comment: pick(f, "comment", "message", "your-message", "text", "mesaj", "qeyd", "комментарий", "сообщение") ?? null,
    utm: Object.fromEntries(Object.entries(f).filter(([k, v]) => /^utm_/.test(k) && v)),
    source,
  };
}

function toDto(h: InboundHook): InboundHookDto {
  const base = config().PUBLIC_API_URL ?? config().WEB_ORIGIN;
  return {
    id: h.id,
    kind: h.kind as InboundKind,
    name: h.name,
    url: `${base}/api/v1/public/in/${h.tenantId}.${h.token}`,
    hasSecret: !!h.secret,
    ownerId: h.ownerId,
    createDeal: h.createDeal,
    active: h.active,
    received: h.received,
    lastReceivedAt: h.lastReceivedAt?.toISOString() ?? null,
    lastError: h.lastError,
  };
}
