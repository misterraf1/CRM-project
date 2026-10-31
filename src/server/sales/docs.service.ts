import { docTotals, maxLineDiscount, ROLE_PERMISSIONS, type DocDto, type DocInput, type DocKind, type DocLineDto, type DocShareResponse, type DocStatus, type DocSummaryDto, type PaymentInput } from "@/shared";
import { ActivityService } from "../crm/activity.service";
import { AuditService } from "../audit/audit.service";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { randomToken, sha256 } from "../common/ids";
import { addDays, startOfDay } from "../common/time";
import { config } from "../config";
import { memberRefs, ownerScope } from "../crm/scope";
import { toBaseAmount } from "../crm/settings.service";
import type { Database, Tx } from "../db/database";
import type { DocLine, SalesDoc, Tenant } from "../db/models";
import { and, contains } from "../db/query";
import type { Filter } from "../db/repo";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";

const LIST_LIMIT = 300;
const PREFIX: Record<DocKind, string> = { quote: "T", invoice: "F" };

/** Gap-free per company, kind and year: T-2026-0001 (quotes), F-2026-0001 (invoices). */
async function nextNumber(tx: Tx, tenantId: string, kind: DocKind, now = new Date()) {
  const year = now.getUTCFullYear();
  const id = `doc:${tenantId}:${kind}:${year}`;
  const counter = await tx.counter.upsert({ id }, { $inc: { value: 1 } }, { id, value: 1 });
  return `${PREFIX[kind]}-${year}-${String(counter.value).padStart(4, "0")}`;
}

/** A date picked in a form means "through that day" in the company's time zone. */
export const endOfDayIn = (date: string, timeZone: string) => new Date(addDays(startOfDay(new Date(`${date}T12:00:00Z`), timeZone), 1, timeZone).getTime() - 1);

/** Customer links look like `<tenantId>.<secret>`; only sha256(secret) is stored. */
export function parseDocToken(token: string) {
  const dot = token.indexOf(".");
  if (dot < 1 || token.length > 200) throw notFound("Document");
  return { tenantId: token.slice(0, dot), hash: sha256(token.slice(dot + 1)) };
}

/** Derived states: never stored, so they can't go stale. */
export function derived(d: Pick<SalesDoc, "kind" | "status" | "dueDate" | "total" | "paidAmount">, now = new Date()) {
  const late = !!d.dueDate && d.dueDate < now;
  return {
    expired: d.kind === "quote" && d.status === "sent" && late,
    overdue: d.kind === "invoice" && d.status === "issued" && late && d.paidAmount < d.total,
  };
}

const lineDto = (l: DocLine): DocLineDto => ({ ...l });

/** A quote with a line discount over the company limit (no limit = never). */
export function needsApproval(d: Pick<SalesDoc, "kind" | "lines">, tenant: Pick<Tenant, "docSettings">) {
  const limit = tenant.docSettings?.maxDiscountBp;
  return d.kind === "quote" && limit !== null && limit !== undefined && maxLineDiscount(d.lines) > limit;
}

/** Active members who may approve discounts: built-in roles with the right, or custom roles carrying it. */
async function approvers(tx: Tx, tenantId: string) {
  const [members, roles] = await Promise.all([
    tx.membership.find({ tenantId, status: "ACTIVE" }, { projection: { id: 1, role: 1, roleId: 1, permissions: 1 } }),
    tx.role.find({ tenantId, permissions: "discounts.approve" }, { projection: { id: 1 } }),
  ]);
  const custom = new Set(roles.map((r) => r.id));
  return members.filter((m) => (m.roleId ? custom.has(m.roleId) : ROLE_PERMISSIONS[m.role].includes("discounts.approve"))).map((m) => m.id);
}

/**
 * Quotes and customer invoices. Quotes follow the contact visibility rules (own,
 * department, all); invoices belong to finance. Totals are always recomputed here —
 * the browser's numbers are only a preview.
 */
export class SalesDocsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  // ─── Reading ──────────────────────────────────────────────

  async list(q: { kind: DocKind; status?: string; dealId?: string; contactId?: string; q?: string }): Promise<DocSummaryDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const scope = await this.scope(tx, ctx, q.kind);
      const now = new Date();
      // Derived states filter on dates; the stored status narrows first
      const status =
        q.status === "expired"
          ? { status: "sent", dueDate: { $lt: now } }
          : q.status === "overdue"
            ? { status: "issued", dueDate: { $lt: now } }
            : q.status
              ? { status: q.status }
              : {};
      const where = and(
        { tenantId: ctx.tenantId, kind: q.kind, ...status, ...(q.dealId ? { dealId: q.dealId } : {}), ...(q.contactId ? { contactId: q.contactId } : {}) },
        q.q ? { number: contains(q.q) } : null,
        scope,
      );
      const rows = await tx.salesDoc.find(where, { sort: { createdAt: -1 }, limit: LIST_LIMIT });
      return this.summaries(tx, ctx.tenantId, rows);
    });
  }

  async get(id: string): Promise<DocDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => this.detail(tx, ctx, await this.visible(tx, ctx, id)));
  }

  /** Quotes and (for finance) invoices of one deal, for the deal page. */
  async forDeal(dealId: string): Promise<DocSummaryDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const kinds: DocKind[] = [];
      if (this.can(ctx, "quote")) kinds.push("quote");
      if (this.can(ctx, "invoice")) kinds.push("invoice");
      const rows: SalesDoc[] = [];
      for (const kind of kinds) rows.push(...(await tx.salesDoc.find(and({ tenantId: ctx.tenantId, kind, dealId }, await this.scope(tx, ctx, kind)), { sort: { createdAt: -1 }, limit: 50 })));
      return this.summaries(tx, ctx.tenantId, rows);
    });
  }

  // ─── Writing ──────────────────────────────────────────────

  async create(kind: DocKind, input: DocInput): Promise<DocDto> {
    const ctx = authedContext();
    this.assertWrite(ctx, kind);
    return this.db.scoped(async (tx) => {
      const tenant = await tx.tenant.get({ id: ctx.tenantId });
      const fields = await this.fields(tx, ctx, tenant, input);
      const doc = await tx.salesDoc.insertOne({
        tenantId: ctx.tenantId,
        kind,
        // Invoices are numbered when issued, so the sequence has no gaps from discarded drafts
        number: kind === "quote" ? await nextNumber(tx, ctx.tenantId, kind) : null,
        status: "draft",
        ownerId: ctx.membershipId,
        createdById: ctx.membershipId,
        ...fields,
      });
      await this.audit.log(tx, { action: `${kind}.created`, entityType: kind, entityId: doc.id, diff: { number: doc.number, total: doc.total, currency: doc.currency } });
      return this.detail(tx, ctx, doc);
    });
  }

  /** Drafts (and quotes already sent, before the customer answered) can still change. */
  async update(id: string, input: DocInput): Promise<DocDto> {
    // (a changed quote over the discount limit needs a fresh approval, see below)
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const doc = await this.visible(tx, ctx, id);
      this.assertWrite(ctx, doc.kind);
      const editable = doc.status === "draft" || (doc.kind === "quote" && doc.status === "sent");
      if (!editable) throw new AppError("CONFLICT", "This document can no longer be changed", { status: doc.status });
      const tenant = await tx.tenant.get({ id: ctx.tenantId });
      const fields = await this.fields(tx, ctx, tenant, input);
      const linesChanged = JSON.stringify(fields.lines) !== JSON.stringify(doc.lines);
      const reapprove = doc.approval && linesChanged && needsApproval({ ...doc, lines: fields.lines }, tenant);
      const updated = await tx.salesDoc.update({ id }, { $set: { ...fields, ...(reapprove || (doc.approval && !needsApproval({ ...doc, lines: fields.lines }, tenant)) ? { approval: null } : {}) } });
      await this.audit.log(tx, { action: `${doc.kind}.updated`, entityType: doc.kind, entityId: id, diff: { total: { from: doc.total, to: updated.total } } });
      return this.detail(tx, ctx, updated);
    });
  }

  async remove(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const doc = await this.visible(tx, ctx, id);
      this.assertWrite(ctx, doc.kind);
      if (doc.status !== "draft") throw new AppError("CONFLICT", "Only drafts can be deleted", { status: doc.status });
      await tx.salesDoc.delete({ id });
      await this.audit.log(tx, { action: `${doc.kind}.deleted`, entityType: doc.kind, entityId: id, diff: { number: doc.number, total: doc.total } });
    });
  }

  /**
   * Makes the customer link (a new one each time: the previous link stops working) and,
   * with `email`, sends it. A draft quote becomes "sent"; a draft invoice is issued.
   */
  async send(id: string, opts: { to?: string; email: boolean; reminder?: boolean }): Promise<DocShareResponse> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const doc = await this.visible(tx, ctx, id);
      this.assertWrite(ctx, doc.kind);
      if (doc.status === "void") throw new AppError("CONFLICT", "A void invoice can't be sent", { status: doc.status });
      if (doc.kind === "quote" && doc.status !== "draft" && doc.status !== "sent") {
        throw new AppError("CONFLICT", "The customer already answered this quote", { status: doc.status });
      }
      const [tenant, contact] = await Promise.all([tx.tenant.get({ id: ctx.tenantId }), tx.contact.findOne({ id: doc.contactId, tenantId: ctx.tenantId })]);
      if (opts.reminder && (doc.kind !== "invoice" || doc.status !== "issued")) throw new AppError("CONFLICT", "Reminders are for issued, unpaid invoices", { status: doc.status });
      // Over the discount limit a quote goes out only once approved (approvers send it straight away)
      if (needsApproval(doc, tenant) && doc.approval?.status !== "approved" && !ctx.permissions.includes("discounts.approve")) {
        throw new AppError("APPROVAL_REQUIRED", "The discount is over the company limit and needs approval", { maxDiscountBp: tenant.docSettings?.maxDiscountBp ?? null });
      }
      const secret = randomToken(24);
      const now = new Date();
      const set: Partial<SalesDoc> = { publicToken: sha256(secret), sentAt: now };
      if (doc.status === "draft") {
        set.status = doc.kind === "quote" ? "sent" : "issued";
        set.issueDate = now;
        if (doc.kind === "invoice") set.number = await nextNumber(tx, ctx.tenantId, "invoice", now);
      }
      const updated = await tx.salesDoc.update({ id }, { $set: set });
      const publicPath = `/p/${ctx.tenantId}.${secret}`;

      let emailDelivery: DocShareResponse["emailDelivery"] = "not_sent";
      if (opts.email) {
        const to = opts.to ?? contact?.email ?? null;
        if (!to) emailDelivery = "no_email";
        else {
          await this.mail.queue(tx, {
            tenantId: ctx.tenantId,
            to,
            locale: tenant.locale,
            template: opts.reminder ? "invoice_reminder" : doc.kind === "quote" ? "quote_sent" : "invoice_sent",
            vars: {
              company: tenant.name,
              number: updated.number ?? "",
              amount: `${((opts.reminder ? updated.total - updated.paidAmount : updated.total) / 100).toFixed(2)} ${updated.currency}`,
              link: `${config().WEB_ORIGIN}${publicPath}`,
            },
          });
          emailDelivery = this.mail.configured ? "queued" : "not_configured";
        }
      }
      if (doc.status === "draft") {
        await this.activity.record(tx, {
          type: doc.kind === "quote" ? "quote_sent" : "invoice_issued",
          contactId: doc.contactId,
          dealId: doc.dealId,
          payload: { number: updated.number, amount: updated.total, currency: updated.currency, docId: id },
        });
      }
      await this.audit.log(tx, { action: opts.reminder ? "invoice.reminded" : `${doc.kind}.sent`, entityType: doc.kind, entityId: id, diff: { number: updated.number, email: opts.email ? (emailDelivery === "no_email" ? null : (opts.to ?? contact?.email ?? null)) : null } });
      return { doc: await this.detail(tx, ctx, updated), publicPath, emailDelivery };
    });
  }

  /**
   * Discount approval: the writer asks, a holder of discounts.approve decides. Only
   * quotes over the company limit need it; their writers are told the outcome.
   */
  async approval(id: string, action: "request" | "approve" | "reject", note: string | null): Promise<DocDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const doc = await this.visible(tx, ctx, id);
      if (doc.kind !== "quote") throw notFound("Quote");
      if (doc.status !== "draft" && doc.status !== "sent") throw new AppError("CONFLICT", "The customer already answered this quote", { status: doc.status });
      const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { docSettings: 1 } });
      if (!needsApproval(doc, tenant)) throw new AppError("CONFLICT", "No discount over the limit: nothing to approve");
      const now = new Date();
      if (action === "request") {
        this.assertWrite(ctx, "quote");
        if (doc.approval?.status === "pending") throw new AppError("CONFLICT", "Already waiting for approval");
        const updated = await tx.salesDoc.update({ id }, { $set: { approval: { status: "pending", requestedById: ctx.membershipId, decidedById: null, at: now, note } } });
        await this.notifications.notify(tx, ctx.tenantId, await approvers(tx, ctx.tenantId), "discount_approval_requested", { title: doc.number ?? "", docId: id }, ctx.membershipId);
        await this.audit.log(tx, { action: "quote.approval_requested", entityType: "quote", entityId: id, diff: { discountBp: maxLineDiscount(doc.lines) } });
        return this.detail(tx, ctx, updated);
      }
      if (!ctx.permissions.includes("discounts.approve")) throw forbidden("Requires permission discounts.approve");
      if (doc.approval?.status !== "pending") throw new AppError("CONFLICT", "No approval request is waiting");
      const status = action === "approve" ? "approved" : "rejected";
      const updated = await tx.salesDoc.update({ id }, { $set: { approval: { ...doc.approval, status, decidedById: ctx.membershipId, at: now, note } } });
      await this.notifications.notify(tx, ctx.tenantId, [doc.approval.requestedById, doc.ownerId], status === "approved" ? "discount_approved" : "discount_rejected", { title: doc.number ?? "", docId: id }, ctx.membershipId);
      await this.audit.log(tx, { action: `quote.discount_${status}`, entityType: "quote", entityId: id, diff: { discountBp: maxLineDiscount(doc.lines), note } });
      return this.detail(tx, ctx, updated);
    });
  }

  /** Staff records the customer's answer given by phone or in person. */
  async respond(id: string, decision: "accept" | "reject") {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const doc = await this.visible(tx, ctx, id);
      this.assertWrite(ctx, "quote");
      if (doc.kind !== "quote") throw notFound("Quote");
      const me = await tx.user.get({ id: ctx.userId }, { projection: { fullName: 1 } });
      const updated = await this.applyResponse(tx, doc, { decision, name: me.fullName, comment: null }, false);
      return this.detail(tx, ctx, updated);
    });
  }

  /**
   * The customer's (or staff's) answer to a sent quote. Accepting puts the quote's total
   * on its open deal; the quote's owner is told either way.
   */
  async applyResponse(tx: Tx, doc: SalesDoc, r: { decision: "accept" | "reject"; name: string; comment: string | null }, byCustomer: boolean) {
    if (doc.status !== "sent") throw new AppError("CONFLICT", "This quote is not waiting for an answer", { status: doc.status });
    if (byCustomer && derived(doc).expired) throw new AppError("CONFLICT", "This quote has expired", { expired: true });
    const at = new Date();
    const updated = await tx.salesDoc.update(
      { id: doc.id },
      { $set: { status: r.decision === "accept" ? "accepted" : "rejected", response: { decision: r.decision, name: r.name, comment: r.comment, at } } },
    );
    if (r.decision === "accept" && doc.dealId) {
      const deal = await tx.deal.findOne({ id: doc.dealId, tenantId: doc.tenantId });
      const stage = deal && (await tx.pipelineStage.findOne({ id: deal.stageId }));
      if (deal && stage?.kind === "open") {
        await tx.deal.update({ id: deal.id }, { $set: { amount: doc.total, currency: doc.currency, baseAmount: doc.baseTotal } });
      }
    }
    await this.activity.record(tx, {
      type: r.decision === "accept" ? "quote_accepted" : "quote_rejected",
      contactId: doc.contactId,
      dealId: doc.dealId,
      payload: { number: doc.number, amount: doc.total, currency: doc.currency, by: r.name, comment: r.comment, docId: doc.id },
    });
    await this.audit.log(tx, { action: `quote.${r.decision === "accept" ? "accepted" : "rejected"}`, entityType: "quote", entityId: doc.id, tenantId: doc.tenantId, diff: { by: r.name, customer: byCustomer } });
    await this.notifications.notify(
      tx,
      doc.tenantId,
      [doc.ownerId],
      r.decision === "accept" ? "quote_accepted" : "quote_rejected",
      { title: doc.number ?? "", docId: doc.id, dealId: doc.dealId ?? undefined },
      byCustomer ? undefined : (authedContext().membershipId ?? undefined),
    );
    return updated;
  }

  /** Draft invoice with the quote's lines; the quote stays as it is. */
  /** A new draft version of a quote (the customer asked for changes); the old one stays as it was. */
  async newVersion(quoteId: string): Promise<DocDto> {
    const ctx = authedContext();
    this.assertWrite(ctx, "quote");
    return this.db.scoped(async (tx) => {
      const quote = await this.visible(tx, ctx, quoteId);
      if (quote.kind !== "quote" || quote.status === "draft") throw new AppError("CONFLICT", "Only a sent quote gets a new version", { status: quote.status });
      const copy = await tx.salesDoc.insertOne({
        tenantId: ctx.tenantId,
        kind: "quote",
        number: null,
        status: "draft",
        contactId: quote.contactId,
        dealId: quote.dealId,
        ownerId: quote.ownerId,
        sourceId: quote.id,
        currency: quote.currency,
        lines: quote.lines,
        subtotal: quote.subtotal,
        discountTotal: quote.discountTotal,
        taxTotal: quote.taxTotal,
        total: quote.total,
        baseTotal: quote.baseTotal,
        notes: quote.notes,
        createdById: ctx.membershipId,
      });
      await this.audit.log(tx, { action: "quote.versioned", entityType: "quote", entityId: copy.id, diff: { from: quote.number } });
      return this.detail(tx, ctx, copy);
    });
  }

  async toInvoice(quoteId: string): Promise<DocDto> {
    const ctx = authedContext();
    this.assertWrite(ctx, "invoice");
    return this.db.scoped(async (tx) => {
      const quote = await this.visible(tx, ctx, quoteId);
      if (quote.kind !== "quote") throw notFound("Quote");
      if (quote.status === "draft" || quote.status === "rejected") throw new AppError("CONFLICT", "Only a sent or accepted quote becomes an invoice", { status: quote.status });
      const invoice = await tx.salesDoc.insertOne({
        tenantId: ctx.tenantId,
        kind: "invoice",
        number: null,
        status: "draft",
        contactId: quote.contactId,
        dealId: quote.dealId,
        ownerId: quote.ownerId,
        sourceId: quote.id,
        currency: quote.currency,
        lines: quote.lines,
        subtotal: quote.subtotal,
        discountTotal: quote.discountTotal,
        taxTotal: quote.taxTotal,
        total: quote.total,
        baseTotal: quote.baseTotal,
        notes: quote.notes,
        createdById: ctx.membershipId,
      });
      await this.audit.log(tx, { action: "invoice.created", entityType: "invoice", entityId: invoice.id, diff: { from: quote.number, total: invoice.total } });
      return this.detail(tx, ctx, invoice);
    });
  }

  async addPayment(id: string, input: PaymentInput): Promise<DocDto> {
    const ctx = authedContext();
    this.assertWrite(ctx, "invoice");
    return this.db.scoped(async (tx) => {
      const doc = await this.visible(tx, ctx, id);
      if (doc.kind !== "invoice") throw notFound("Invoice");
      if (doc.status !== "issued") throw new AppError("CONFLICT", "Payments are recorded on issued, unpaid invoices", { status: doc.status });
      const left = doc.total - doc.paidAmount;
      if (input.amount > left) throw new AppError("VALIDATION_FAILED", "More than the amount due", { amount: [`At most ${left}`] });
      const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { timezone: 1 } });
      await tx.docPayment.insertOne({
        tenantId: ctx.tenantId,
        docId: id,
        amount: input.amount,
        method: input.method,
        paidOn: startOfDay(new Date(`${input.paidOn}T12:00:00Z`), tenant.timezone),
        reference: input.reference ?? null,
        note: input.note ?? null,
        recordedById: ctx.membershipId,
      });
      const updated = await this.settle(tx, doc);
      await this.audit.log(tx, { action: "invoice.payment_recorded", entityType: "invoice", entityId: id, diff: { amount: input.amount, method: input.method, paid: updated.paidAmount } });
      return this.detail(tx, ctx, updated);
    });
  }

  /** Undo a payment recorded by mistake. */
  async removePayment(id: string, paymentId: string): Promise<DocDto> {
    const ctx = authedContext();
    this.assertWrite(ctx, "invoice");
    return this.db.scoped(async (tx) => {
      const doc = await this.visible(tx, ctx, id);
      const payment = await tx.docPayment.findOne({ id: paymentId, docId: id, tenantId: ctx.tenantId });
      if (doc.kind !== "invoice" || !payment) throw notFound("Payment");
      await tx.docPayment.delete({ id: paymentId });
      const updated = await this.settle(tx, doc);
      await this.audit.log(tx, { action: "invoice.payment_removed", entityType: "invoice", entityId: id, diff: { amount: payment.amount, paid: updated.paidAmount } });
      return this.detail(tx, ctx, updated);
    });
  }

  /** Cancels an issued invoice nobody has paid on; its number stays used (no gaps). */
  async void(id: string): Promise<DocDto> {
    const ctx = authedContext();
    this.assertWrite(ctx, "invoice");
    return this.db.scoped(async (tx) => {
      const doc = await this.visible(tx, ctx, id);
      if (doc.kind !== "invoice") throw notFound("Invoice");
      if (doc.status !== "issued" || doc.paidAmount > 0) throw new AppError("CONFLICT", "Only an issued invoice without payments can be voided", { status: doc.status });
      const updated = await tx.salesDoc.update({ id }, { $set: { status: "void", publicToken: null } });
      await this.audit.log(tx, { action: "invoice.voided", entityType: "invoice", entityId: id, diff: { number: doc.number, total: doc.total } });
      return this.detail(tx, ctx, updated);
    });
  }

  /** One notice per invoice when it passes its due date unpaid (run by the overdue job). */
  async notifyOverdue(): Promise<number> {
    const due = await this.db.system.salesDoc.find(
      { kind: "invoice", status: "issued", dueDate: { $lt: new Date(), $ne: null }, overdueNotifiedAt: null },
      { projection: { tenantId: 1, id: 1 }, sort: { dueDate: 1 }, limit: 200 },
    );
    let sent = 0;
    for (const { tenantId, id } of due) {
      sent += await this.db.scoped(
        async (tx) => {
          // Claimed with a conditional update: with several instances only one notifies
          const claimed = await tx.salesDoc.updateMany({ id, tenantId, overdueNotifiedAt: null }, { $set: { overdueNotifiedAt: new Date() } });
          if (!claimed.count) return 0;
          const doc = await tx.salesDoc.get({ id });
          await this.notifications.notify(tx, tenantId, [doc.ownerId], "invoice_overdue", { title: doc.number ?? "", docId: id, amount: doc.total - doc.paidAmount });
          return 1;
        },
        { tenantId },
      );
    }
    return sent;
  }

  // ─── Internals ────────────────────────────────────────────

  /** Recomputes the paid amount from the payments and the status from it. */
  private async settle(tx: Tx, doc: SalesDoc) {
    const payments = await tx.docPayment.find({ docId: doc.id, tenantId: doc.tenantId }, { projection: { amount: 1 } });
    const paidAmount = payments.reduce((a, p) => a + p.amount, 0);
    const status = paidAmount >= doc.total ? "paid" : "issued";
    const updated = await tx.salesDoc.update({ id: doc.id }, { $set: { paidAmount, status } });
    if (status === "paid" && doc.status !== "paid") {
      await this.activity.record(tx, { type: "invoice_paid", contactId: doc.contactId, dealId: doc.dealId, payload: { number: doc.number, amount: doc.total, currency: doc.currency, docId: doc.id } });
    }
    return updated;
  }

  /** Validated, computed fields of a document from the form. */
  private async fields(tx: Tx, ctx: AuthedContext, tenant: Tenant, input: DocInput) {
    const contactScope = ctx.permissions.includes("finance.view") ? {} : (await ownerScope(tx, ctx, "contacts.view_all")).where;
    const [contact, deal, products] = await Promise.all([
      tx.contact.findOne(and({ id: input.contactId, tenantId: ctx.tenantId, deletedAt: null }, contactScope), { projection: { id: 1 } }),
      input.dealId ? tx.deal.findOne({ id: input.dealId, tenantId: ctx.tenantId }, { projection: { id: 1 } }) : null,
      tx.product.find({ tenantId: ctx.tenantId, id: { $in: [...new Set(input.lines.map((l) => l.productId).filter((x): x is string => !!x))] } }, { projection: { id: 1 } }),
    ]);
    if (!contact) throw new AppError("VALIDATION_FAILED", "Unknown customer", { contactId: ["Unknown contact"] });
    if (input.dealId && !deal) throw new AppError("VALIDATION_FAILED", "Unknown deal", { dealId: ["Unknown deal"] });
    const known = new Set(products.map((p) => p.id));
    if (input.lines.some((l) => l.productId && !known.has(l.productId))) throw new AppError("VALIDATION_FAILED", "Unknown product", { lines: ["Unknown product"] });

    const totals = docTotals(input.lines);
    const lines: DocLine[] = input.lines.map((l, i) => ({
      productId: l.productId ?? null,
      name: l.name,
      description: l.description ?? null,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      discountBp: l.discountBp ?? 0,
      taxBp: l.taxBp ?? 0,
      ...totals.lines[i]!,
    }));
    return {
      contactId: input.contactId,
      dealId: input.dealId ?? null,
      currency: input.currency,
      lines,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      baseTotal: toBaseAmount(totals.total, input.currency, tenant),
      dueDate: input.dueDate ? endOfDayIn(input.dueDate, tenant.timezone) : null,
      notes: input.notes ?? null,
    };
  }

  private can(ctx: AuthedContext, kind: DocKind) {
    const p = ctx.permissions;
    return p.includes("finance.view") || p.includes(kind === "quote" ? "quotes.manage" : "invoices.manage");
  }

  private assertWrite(ctx: AuthedContext, kind: DocKind) {
    const needed = kind === "quote" ? "quotes.manage" : "invoices.manage";
    if (!ctx.permissions.includes(needed)) throw forbidden(`Requires permission ${needed}`);
  }

  /** Finance sees every document; everyone else the documents of records they see. */
  private async scope(tx: Tx, ctx: AuthedContext, kind: DocKind): Promise<Filter> {
    if (!this.can(ctx, kind)) throw forbidden(`Requires permission ${kind === "quote" ? "quotes.manage" : "finance.view"}`);
    if (ctx.permissions.includes("finance.view")) return {};
    return (await ownerScope(tx, ctx, "contacts.view_all")).where;
  }

  private async visible(tx: Tx, ctx: AuthedContext, id: string) {
    const doc = await tx.salesDoc.findOne({ id, tenantId: ctx.tenantId });
    if (!doc || !this.can(ctx, doc.kind)) throw notFound("Document");
    if (!(await tx.salesDoc.count(and({ id }, await this.scope(tx, ctx, doc.kind))))) throw notFound("Document");
    return doc;
  }

  private async summaries(tx: Tx, tenantId: string, rows: SalesDoc[]): Promise<DocSummaryDto[]> {
    const [contacts, deals, owners] = await Promise.all([
      tx.contact.find({ tenantId, id: { $in: [...new Set(rows.map((r) => r.contactId))] } }, { projection: { id: 1, name: 1 } }),
      tx.deal.find({ tenantId, id: { $in: [...new Set(rows.map((r) => r.dealId).filter((x): x is string => !!x))] } }, { projection: { id: 1, title: 1 } }),
      memberRefs(tx, tenantId, rows.map((r) => r.ownerId)),
    ]);
    const contactOf = new Map(contacts.map((c) => [c.id, c]));
    const dealOf = new Map(deals.map((d) => [d.id, d]));
    const now = new Date();
    return rows.map((d) => {
      const owner = d.ownerId ? owners.get(d.ownerId) : undefined;
      const contact = contactOf.get(d.contactId);
      const deal = d.dealId ? dealOf.get(d.dealId) : undefined;
      return {
        id: d.id,
        kind: d.kind,
        number: d.number,
        status: d.status as DocStatus,
        ...derived(d, now),
        contact: contact ? { id: contact.id, name: contact.name } : null,
        deal: deal ? { id: deal.id, title: deal.title } : null,
        owner: owner ? { id: owner.id, name: owner.name } : null,
        currency: d.currency,
        total: d.total,
        paidAmount: d.paidAmount,
        dueDate: d.dueDate?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      };
    });
  }

  private async detail(tx: Tx, ctx: AuthedContext, d: SalesDoc): Promise<DocDto> {
    const [[summary], payments, invoices, orders, tenant] = await Promise.all([
      this.summaries(tx, ctx.tenantId, [d]),
      d.kind === "invoice" ? tx.docPayment.find({ docId: d.id, tenantId: ctx.tenantId }, { sort: { paidOn: 1, createdAt: 1 } }) : [],
      d.kind === "quote" && this.can(ctx, "invoice")
        ? tx.salesDoc.find({ tenantId: ctx.tenantId, kind: "invoice", sourceId: d.id }, { projection: { id: 1, number: 1, status: 1 } })
        : [],
      d.kind === "quote" ? tx.order.find({ tenantId: ctx.tenantId, quoteId: d.id }, { projection: { id: 1, number: 1, status: 1 } }) : [],
      tx.tenant.get({ id: ctx.tenantId }, { projection: { docSettings: 1 } }),
    ]);
    const names = await memberRefs(tx, ctx.tenantId, [d.approval?.requestedById, d.approval?.decidedById]);
    const recorders = await memberRefs(tx, ctx.tenantId, payments.map((p) => p.recordedById));
    return {
      ...summary!,
      lines: d.lines.map(lineDto),
      subtotal: d.subtotal,
      discountTotal: d.discountTotal,
      taxTotal: d.taxTotal,
      notes: d.notes,
      issueDate: d.issueDate?.toISOString() ?? null,
      sentAt: d.sentAt?.toISOString() ?? null,
      sourceId: d.sourceId,
      invoices: invoices.map((i) => ({ id: i.id, number: i.number, status: i.status as DocStatus })),
      response: d.response ? { ...d.response, at: d.response.at.toISOString() } : null,
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method as DocDto["payments"][number]["method"],
        paidOn: p.paidOn.toISOString(),
        reference: p.reference,
        note: p.note,
        recordedBy: p.recordedById ? (recorders.get(p.recordedById)?.name ?? null) : null,
        createdAt: p.createdAt.toISOString(),
      })),
      shared: !!d.publicToken,
      needsApproval: needsApproval(d, tenant),
      approval: d.approval
        ? {
            status: d.approval.status,
            requestedBy: d.approval.requestedById ? (names.get(d.approval.requestedById)?.name ?? null) : null,
            decidedBy: d.approval.decidedById ? (names.get(d.approval.decidedById)?.name ?? null) : null,
            at: d.approval.at.toISOString(),
            note: d.approval.note,
          }
        : null,
      orders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status })),
    };
  }
}
