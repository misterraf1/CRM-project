import { ORDER_LIMITS, type OrderCreateInput, type OrderDto, type OrderStatus, type OrderSummaryDto } from "@/shared";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { createId } from "../db/repo";
import { ActivityService } from "../crm/activity.service";
import { memberRefs, ownerScope, resolveOwner } from "../crm/scope";
import type { Database, Tx } from "../db/database";
import type { Order, OrderStep, Tenant } from "../db/models";
import { and } from "../db/query";
import { NotificationsService } from "../notifications/notifications.service";
import { orderStepUpdateSchema, orderUpdateSchema } from "@/shared";
import { endOfDayIn } from "./docs.service";

type StepPatch = z.infer<typeof orderStepUpdateSchema>;
type OrderPatch = z.infer<typeof orderUpdateSchema>;

const LIST_LIMIT = 300;

/** Gap-free per company and year: S-2026-0001. */
async function nextOrderNumber(tx: Tx, tenantId: string, now = new Date()) {
  const year = now.getUTCFullYear();
  const id = `doc:${tenantId}:order:${year}`;
  const counter = await tx.counter.upsert({ id }, { $inc: { value: 1 } }, { id, value: 1 });
  return `S-${year}-${String(counter.value).padStart(4, "0")}`;
}

/** Status follows the steps; a canceled order stays canceled until reopened. */
function statusOf(steps: OrderStep[], canceled: boolean): OrderStatus {
  if (canceled) return "canceled";
  const done = steps.filter((s) => s.doneAt).length;
  if (steps.length && done === steps.length) return "done";
  return done ? "in_progress" : "new";
}

const isLate = (o: Pick<Order, "status" | "dueDate">, now = new Date()) => !!o.dueDate && o.dueDate < now && o.status !== "done" && o.status !== "canceled";

/**
 * What happens after the sale: an order with execution steps, each with an owner and a
 * date. Visibility follows the contact rules (own, department, all) through the order's owner.
 */
export class OrdersService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(q: { status?: string; dealId?: string; contactId?: string }): Promise<OrderSummaryDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const { where } = await ownerScope(tx, ctx, "contacts.view_all");
      const status = q.status === "overdue" ? { status: { $in: ["new", "in_progress"] }, dueDate: { $lt: new Date() } } : q.status ? { status: q.status } : {};
      const rows = await tx.order.find(
        and({ tenantId: ctx.tenantId, ...status, ...(q.dealId ? { dealId: q.dealId } : {}), ...(q.contactId ? { contactId: q.contactId } : {}) }, where),
        { sort: { createdAt: -1 }, limit: LIST_LIMIT },
      );
      return this.summaries(tx, ctx.tenantId, rows);
    });
  }

  async get(id: string): Promise<OrderDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => this.detail(tx, ctx, await this.visible(tx, ctx, id)));
  }

  /** From a quote (its total, customer and deal are taken over) or by hand. */
  async create(input: OrderCreateInput): Promise<OrderDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const tenant = await tx.tenant.get({ id: ctx.tenantId });
      const { where } = await ownerScope(tx, ctx, "contacts.view_all");
      const [contact, deal, quote] = await Promise.all([
        tx.contact.findOne(and({ id: input.contactId, tenantId: ctx.tenantId, deletedAt: null }, where), { projection: { id: 1, name: 1 } }),
        input.dealId ? tx.deal.findOne({ id: input.dealId, tenantId: ctx.tenantId }, { projection: { id: 1 } }) : null,
        input.quoteId ? tx.salesDoc.findOne({ id: input.quoteId, tenantId: ctx.tenantId, kind: "quote" }) : null,
      ]);
      if (!contact) throw new AppError("VALIDATION_FAILED", "Unknown customer", { contactId: ["Unknown contact"] });
      if (input.dealId && !deal) throw new AppError("VALIDATION_FAILED", "Unknown deal", { dealId: ["Unknown deal"] });
      if (input.quoteId && (!quote || quote.status === "draft" || quote.status === "rejected")) {
        throw new AppError("VALIDATION_FAILED", "Orders are made from sent or accepted quotes", { quoteId: ["Not usable"] });
      }
      const steps = await this.newSteps(tx, ctx, tenant, input.steps);
      const order = await tx.order.insertOne({
        tenantId: ctx.tenantId,
        number: await nextOrderNumber(tx, ctx.tenantId),
        title: input.title,
        status: "new",
        contactId: contact.id,
        dealId: input.dealId ?? quote?.dealId ?? null,
        quoteId: quote?.id ?? null,
        ownerId: ctx.membershipId,
        currency: quote?.currency ?? tenant.currency,
        total: quote?.total ?? 0,
        dueDate: input.dueDate ? endOfDayIn(input.dueDate, tenant.timezone) : null,
        deliveryDate: input.deliveryDate ? endOfDayIn(input.deliveryDate, tenant.timezone) : null,
        notes: input.notes ?? null,
        steps,
      });
      await this.activity.record(tx, { type: "order_created", contactId: order.contactId, dealId: order.dealId, payload: { number: order.number, orderId: order.id, title: order.title } });
      await this.audit.log(tx, { action: "order.created", entityType: "order", entityId: order.id, diff: { number: order.number, quote: quote?.number ?? null } });
      await this.tellAssignees(tx, ctx, order, steps);
      return this.detail(tx, ctx, order);
    });
  }

  async update(id: string, input: OrderPatch): Promise<OrderDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const order = await this.visible(tx, ctx, id);
      const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { timezone: 1 } });
      const set: Partial<Order> = {};
      if (input.title !== undefined) set.title = input.title;
      if (input.notes !== undefined) set.notes = input.notes ?? null;
      if (input.dueDate !== undefined) set.dueDate = input.dueDate ? endOfDayIn(input.dueDate, tenant.timezone) : null;
      if (input.deliveryDate !== undefined) set.deliveryDate = input.deliveryDate ? endOfDayIn(input.deliveryDate, tenant.timezone) : null;
      if (input.ownerId !== undefined) set.ownerId = await resolveOwner(tx, ctx, input.ownerId, order.ownerId);
      if (input.canceled !== undefined) {
        set.status = statusOf(order.steps, input.canceled);
        set.completedAt = set.status === "done" ? (order.completedAt ?? new Date()) : null;
      }
      const updated = await tx.order.update({ id }, { $set: set });
      const diff: Record<string, unknown> = { ...input };
      await this.audit.log(tx, { action: input.canceled === true ? "order.canceled" : input.canceled === false ? "order.reopened" : "order.updated", entityType: "order", entityId: id, diff: diff as never });
      return this.detail(tx, ctx, updated);
    });
  }

  async remove(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const order = await this.visible(tx, ctx, id);
      // Work already done stays on record: cancel instead
      if (order.steps.some((s) => s.doneAt)) throw new AppError("CONFLICT", "Steps are already done; cancel the order instead");
      await tx.order.delete({ id });
      await this.audit.log(tx, { action: "order.deleted", entityType: "order", entityId: id, diff: { number: order.number } });
    });
  }

  async addStep(id: string, input: { title: string; assigneeId?: string | null; dueDate?: string | null }): Promise<OrderDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const order = await this.visible(tx, ctx, id);
      if (order.steps.length >= ORDER_LIMITS.steps) throw new AppError("CONFLICT", `At most ${ORDER_LIMITS.steps} steps`);
      this.assertOpen(order);
      const tenant = await tx.tenant.get({ id: ctx.tenantId });
      const [step] = await this.newSteps(tx, ctx, tenant, [input]);
      const steps = [...order.steps, step!];
      const updated = await tx.order.update({ id }, { $set: { steps, status: statusOf(steps, false), completedAt: null } });
      await this.tellAssignees(tx, ctx, updated, [step!]);
      return this.detail(tx, ctx, updated);
    });
  }

  /** Rename, reassign, reschedule, tick off or reopen one step; the order's status follows. */
  async updateStep(id: string, stepId: string, input: StepPatch): Promise<OrderDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const order = await this.visible(tx, ctx, id);
      this.assertOpen(order);
      const step = order.steps.find((s) => s.id === stepId);
      if (!step) throw notFound("Step");
      const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { timezone: 1 } });
      const next: OrderStep = { ...step };
      if (input.title !== undefined) next.title = input.title;
      if (input.dueDate !== undefined) next.dueDate = input.dueDate ? endOfDayIn(input.dueDate, tenant.timezone) : null;
      if (input.assigneeId !== undefined) next.assigneeId = await this.assignee(tx, ctx.tenantId, input.assigneeId);
      if (input.done !== undefined) {
        next.doneAt = input.done ? (step.doneAt ?? new Date()) : null;
        next.doneById = input.done ? (step.doneById ?? ctx.membershipId) : null;
      }
      const steps = order.steps.map((s) => (s.id === stepId ? next : s));
      const status = statusOf(steps, false);
      const updated = await tx.order.update({ id }, { $set: { steps, status, completedAt: status === "done" ? (order.completedAt ?? new Date()) : null } });
      if (next.assigneeId && next.assigneeId !== step.assigneeId) await this.tellAssignees(tx, ctx, updated, [next]);
      if (status === "done" && order.status !== "done") {
        await this.activity.record(tx, { type: "order_done", contactId: order.contactId, dealId: order.dealId, payload: { number: order.number, orderId: order.id, title: order.title } });
        await this.notifications.notify(tx, ctx.tenantId, [order.ownerId], "order_done", { title: order.number, orderId: order.id }, ctx.membershipId);
      }
      if (input.done !== undefined && !!step.doneAt !== input.done) {
        await this.audit.log(tx, { action: input.done ? "order.step_done" : "order.step_reopened", entityType: "order", entityId: id, diff: { step: step.title } });
      }
      return this.detail(tx, ctx, updated);
    });
  }

  async removeStep(id: string, stepId: string): Promise<OrderDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const order = await this.visible(tx, ctx, id);
      this.assertOpen(order);
      if (!order.steps.some((s) => s.id === stepId)) throw notFound("Step");
      const steps = order.steps.filter((s) => s.id !== stepId);
      const status = statusOf(steps, false);
      const updated = await tx.order.update({ id }, { $set: { steps, status, completedAt: status === "done" ? (order.completedAt ?? new Date()) : null } });
      return this.detail(tx, ctx, updated);
    });
  }

  // ─── Internals ────────────────────────────────────────────

  private assertOpen(order: Order) {
    if (order.status === "canceled") throw new AppError("CONFLICT", "Reopen the order first", { status: order.status });
  }

  private async newSteps(tx: Tx, ctx: AuthedContext, tenant: Pick<Tenant, "timezone">, input: { title: string; assigneeId?: string | null; dueDate?: string | null }[]) {
    const steps: OrderStep[] = [];
    for (const s of input) {
      steps.push({
        id: createId(),
        title: s.title,
        assigneeId: await this.assignee(tx, ctx.tenantId, s.assigneeId ?? null),
        dueDate: s.dueDate ? endOfDayIn(s.dueDate, tenant.timezone) : null,
        doneAt: null,
        doneById: null,
      });
    }
    return steps;
  }

  private async assignee(tx: Tx, tenantId: string, id: string | null) {
    if (!id) return null;
    if (!(await tx.membership.count({ id, tenantId, status: "ACTIVE" }))) throw new AppError("VALIDATION_FAILED", "Unknown member", { assigneeId: ["Unknown member"] });
    return id;
  }

  private async tellAssignees(tx: Tx, ctx: AuthedContext, order: Order, steps: OrderStep[]) {
    for (const s of steps) {
      if (s.assigneeId) await this.notifications.notify(tx, ctx.tenantId, [s.assigneeId], "order_step_assigned", { title: `${order.number} · ${s.title}`, orderId: order.id }, ctx.membershipId);
    }
  }

  private async visible(tx: Tx, ctx: AuthedContext, id: string) {
    const { where } = await ownerScope(tx, ctx, "contacts.view_all");
    const order = await tx.order.findOne(and({ id, tenantId: ctx.tenantId }, where));
    if (!order) throw notFound("Order");
    return order;
  }

  private async summaries(tx: Tx, tenantId: string, rows: Order[]): Promise<OrderSummaryDto[]> {
    const [contacts, deals, owners] = await Promise.all([
      tx.contact.find({ tenantId, id: { $in: [...new Set(rows.map((r) => r.contactId))] } }, { projection: { id: 1, name: 1 } }),
      tx.deal.find({ tenantId, id: { $in: [...new Set(rows.map((r) => r.dealId).filter((x): x is string => !!x))] } }, { projection: { id: 1, title: 1 } }),
      memberRefs(tx, tenantId, rows.map((r) => r.ownerId)),
    ]);
    const contactOf = new Map(contacts.map((c) => [c.id, c]));
    const dealOf = new Map(deals.map((d) => [d.id, d]));
    const now = new Date();
    return rows.map((o) => {
      const owner = o.ownerId ? owners.get(o.ownerId) : undefined;
      const c = contactOf.get(o.contactId);
      const d = o.dealId ? dealOf.get(o.dealId) : undefined;
      return {
        id: o.id,
        number: o.number,
        title: o.title,
        status: o.status as OrderStatus,
        overdue: isLate(o, now),
        contact: c ? { id: c.id, name: c.name } : null,
        deal: d ? { id: d.id, title: d.title } : null,
        owner: owner ? { id: owner.id, name: owner.name } : null,
        progress: { done: o.steps.filter((s) => s.doneAt).length, total: o.steps.length },
        currency: o.currency,
        total: o.total,
        dueDate: o.dueDate?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
      };
    });
  }

  private async detail(tx: Tx, ctx: AuthedContext, o: Order): Promise<OrderDto> {
    const [[summary], quote, refs] = await Promise.all([
      this.summaries(tx, ctx.tenantId, [o]),
      o.quoteId ? tx.salesDoc.findOne({ id: o.quoteId, tenantId: ctx.tenantId }, { projection: { id: 1, number: 1 } }) : null,
      memberRefs(tx, ctx.tenantId, o.steps.flatMap((s) => [s.assigneeId, s.doneById])),
    ]);
    const now = new Date();
    return {
      ...summary!,
      quote: quote ? { id: quote.id, number: quote.number } : null,
      deliveryDate: o.deliveryDate?.toISOString() ?? null,
      notes: o.notes,
      completedAt: o.completedAt?.toISOString() ?? null,
      steps: o.steps.map((s) => {
        const a = s.assigneeId ? refs.get(s.assigneeId) : undefined;
        return {
          id: s.id,
          title: s.title,
          assignee: a ? { id: a.id, name: a.name } : null,
          dueDate: s.dueDate?.toISOString() ?? null,
          doneAt: s.doneAt?.toISOString() ?? null,
          doneBy: s.doneById ? (refs.get(s.doneById)?.name ?? null) : null,
          overdue: !s.doneAt && !!s.dueDate && s.dueDate < now && o.status !== "canceled",
        };
      }),
    };
  }
}
