import { CASE_SLA_HOURS, type CaseCreateInput, type CaseDto, type CaseStatus, type CaseSummaryDto, type CaseType, type TaskPriority } from "@/shared";
import type { z } from "zod";
import type { caseListQuerySchema, caseUpdateSchema } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { AutomationRunner } from "../automations/automation.runner";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { newId } from "../common/ids";
import { ActivityService } from "../crm/activity.service";
import { memberRefs, ownerScope } from "../crm/scope";
import type { Database, Tx } from "../db/database";
import type { ServiceCase } from "../db/models";
import { and } from "../db/query";
import type { Filter } from "../db/repo";
import { NotificationsService } from "../notifications/notifications.service";

const ACTIVE: CaseStatus[] = ["open", "in_progress", "waiting"];
const LIST_LIMIT = 300;

/** Gap-free per company and year: M-2026-0001 ("müraciət"). */
async function nextCaseNumber(tx: Tx, tenantId: string, now = new Date()) {
  const year = now.getUTCFullYear();
  const id = `doc:${tenantId}:case:${year}`;
  const counter = await tx.counter.upsert({ id }, { $inc: { value: 1 } }, { id, value: 1 });
  return `M-${year}-${String(counter.value).padStart(4, "0")}`;
}

/** Warranty runs from the order's completion for its warranty months. */
export function warrantyUntil(order: { completedAt: Date | null; warrantyMonths: number | null }) {
  if (!order.completedAt || !order.warrantyMonths) return null;
  const until = new Date(order.completedAt);
  until.setUTCMonth(until.getUTCMonth() + order.warrantyMonths);
  return until;
}

/**
 * Who sees a case: like contacts — everything with contacts.view_all, the department
 * (plus unassigned cases) for managers, otherwise cases the member handles or opened.
 */
async function caseScope(tx: Tx, ctx: AuthedContext): Promise<Filter> {
  const s = await ownerScope(tx, ctx, "contacts.view_all");
  if (!s.memberIds) return {};
  const mine: Filter[] = [{ assigneeId: { $in: s.memberIds } }, { createdById: { $in: s.memberIds } }];
  return { $or: s.scope === "department" ? [...mine, { assigneeId: null }] : mine };
}

/** Customer complaints, warranty claims and service requests after the sale. */
export class CasesService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly automations: AutomationRunner,
  ) {}

  async list(q: z.infer<typeof caseListQuerySchema>): Promise<CaseSummaryDto[]> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const now = new Date();
      const status: Filter =
        q.status === "active" ? { status: { $in: ACTIVE } } : q.status === "overdue" ? { status: { $in: ACTIVE }, dueAt: { $lt: now } } : q.status ? { status: q.status } : {};
      const rows = await tx.serviceCase.find(
        and({ tenantId: ctx.tenantId }, await caseScope(tx, ctx), status, q.contactId ? { contactId: q.contactId } : null, q.mine === "true" ? { assigneeId: ctx.membershipId } : null),
        { sort: { createdAt: -1 }, limit: LIST_LIMIT },
      );
      return this.summaries(tx, ctx.tenantId, rows);
    });
  }

  async get(id: string): Promise<CaseDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => this.detail(tx, ctx, await this.visible(tx, ctx, id)));
  }

  async create(input: CaseCreateInput): Promise<CaseDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const { where } = await ownerScope(tx, ctx, "contacts.view_all");
      const contact = await tx.contact.findOne(and({ id: input.contactId, tenantId: ctx.tenantId, deletedAt: null }, where));
      if (!contact) throw notFound("Contact");
      const order = input.orderId ? await tx.order.findOne({ id: input.orderId, tenantId: ctx.tenantId, contactId: contact.id }) : null;
      if (input.orderId && !order) throw notFound("Order");
      if (input.dealId && !(await tx.deal.count({ id: input.dealId, tenantId: ctx.tenantId }))) throw notFound("Deal");
      const assigneeId = await this.assignee(tx, ctx, input.assigneeId === undefined ? ctx.membershipId : input.assigneeId);
      const now = new Date();
      const until = order ? warrantyUntil(order) : null;
      const row = await tx.serviceCase.insertOne({
        tenantId: ctx.tenantId,
        number: await nextCaseNumber(tx, ctx.tenantId, now),
        contactId: contact.id,
        dealId: input.dealId ?? order?.dealId ?? null,
        orderId: order?.id ?? null,
        type: input.type,
        subject: input.subject,
        description: input.description ?? null,
        priority: input.priority,
        status: "open",
        assigneeId,
        dueAt: new Date(now.getTime() + CASE_SLA_HOURS[input.priority] * 3_600_000),
        warranty: until ? { until, valid: until > now } : null,
        createdById: ctx.membershipId,
      });
      await this.activity.record(tx, { type: "case_opened", contactId: contact.id, dealId: row.dealId, payload: { caseId: row.id, number: row.number, title: row.subject } });
      await this.audit.log(tx, { action: "case.created", entityType: "case", entityId: row.id });
      await this.notifications.notify(tx, ctx.tenantId, [assigneeId], "case_assigned", { caseId: row.id, title: `${row.number} · ${row.subject}` }, ctx.membershipId);
      await this.automations.enqueue(tx, ctx.tenantId, "case.created", { caseId: row.id });
      return this.detail(tx, ctx, row);
    });
  }

  async update(id: string, input: z.infer<typeof caseUpdateSchema>): Promise<CaseDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const current = await this.editable(tx, ctx, id);
      const set: Partial<ServiceCase> = {};
      if (input.subject !== undefined) set.subject = input.subject;
      if (input.resolution !== undefined) set.resolution = input.resolution;
      if (input.priority !== undefined && input.priority !== current.priority) {
        set.priority = input.priority;
        // The target follows the new priority, counted from the opening
        set.dueAt = new Date(current.createdAt.getTime() + CASE_SLA_HOURS[input.priority] * 3_600_000);
        set.overdueNotifiedAt = null;
      }
      if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) set.assigneeId = await this.assignee(tx, ctx, input.assigneeId);
      if (input.status !== undefined && input.status !== current.status) {
        set.status = input.status;
        const closing = input.status === "resolved" || input.status === "closed";
        set.resolvedAt = closing ? (current.resolvedAt ?? new Date()) : null;
      }
      const updated = await tx.serviceCase.update({ id }, { $set: set });
      if (set.status === "resolved" && current.status !== "resolved") {
        await this.activity.record(tx, { type: "case_resolved", contactId: updated.contactId, dealId: updated.dealId, payload: { caseId: id, number: updated.number, title: updated.subject } });
      }
      if (set.assigneeId) await this.notifications.notify(tx, ctx.tenantId, [set.assigneeId], "case_assigned", { caseId: id, title: `${updated.number} · ${updated.subject}` }, ctx.membershipId);
      await this.audit.log(tx, { action: "case.updated", entityType: "case", entityId: id, diff: input as Record<string, string> });
      return this.detail(tx, ctx, updated);
    });
  }

  async addNote(id: string, body: string): Promise<CaseDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const current = await this.visible(tx, ctx, id);
      if (current.notes.length >= 500) throw new AppError("CONFLICT", "Too many notes on this case");
      const updated = await tx.serviceCase.update({ id }, { $push: { notes: { id: newId("cn"), authorId: ctx.membershipId, body, at: new Date() } } });
      // The person handling it hears about colleagues' notes
      await this.notifications.notify(tx, ctx.tenantId, [current.assigneeId], "case_assigned", { caseId: id, title: `${current.number} · ${current.subject}` }, ctx.membershipId);
      return this.detail(tx, ctx, updated);
    });
  }

  /** Cases past their target: one notice to whoever handles each (5-minute job). */
  async notifyOverdue(now = new Date()): Promise<number> {
    const due = await this.db.system.serviceCase.find({ status: { $in: ACTIVE }, dueAt: { $lt: now }, overdueNotifiedAt: null }, { projection: { id: 1, tenantId: 1 }, limit: 200 });
    let sent = 0;
    for (const { id, tenantId } of due) {
      sent += await this.db.scoped(
        async (tx) => {
          const claimed = await tx.serviceCase.updateMany({ id, overdueNotifiedAt: null }, { $set: { overdueNotifiedAt: now } });
          if (!claimed.count) return 0;
          const c = await tx.serviceCase.get({ id });
          await this.notifications.notify(tx, tenantId, [c.assigneeId ?? c.createdById], "case_overdue", { caseId: id, title: `${c.number} · ${c.subject}` });
          return 1;
        },
        { tenantId },
      );
    }
    return sent;
  }

  private async visible(tx: Tx, ctx: AuthedContext, id: string) {
    const row = await tx.serviceCase.findOne(and({ id, tenantId: ctx.tenantId }, await caseScope(tx, ctx)));
    if (!row) throw notFound("Case");
    return row;
  }

  private canEdit(ctx: AuthedContext, c: ServiceCase) {
    return c.assigneeId === ctx.membershipId || c.createdById === ctx.membershipId || ctx.permissions.includes("contacts.manage") || ctx.permissions.includes("contacts.view_all");
  }

  private async editable(tx: Tx, ctx: AuthedContext, id: string) {
    const c = await this.visible(tx, ctx, id);
    if (!this.canEdit(ctx, c)) throw forbidden("Only the person handling the case or a manager can change it");
    return c;
  }

  /** Yourself always; others with tasks.assign_any (like tasks). */
  private async assignee(tx: Tx, ctx: AuthedContext, memberId: string | null) {
    if (!memberId) return null;
    if (memberId !== ctx.membershipId && !ctx.permissions.includes("tasks.assign_any")) throw forbidden("Cannot assign cases to others");
    if (!(await tx.membership.count({ tenantId: ctx.tenantId, id: memberId, status: "ACTIVE" }))) throw new AppError("VALIDATION_FAILED", "Unknown member", { assigneeId: ["Unknown member"] });
    return memberId;
  }

  private async summaries(tx: Tx, tenantId: string, rows: ServiceCase[]): Promise<CaseSummaryDto[]> {
    if (!rows.length) return [];
    const [refs, contacts] = await Promise.all([
      memberRefs(tx, tenantId, rows.map((r) => r.assigneeId)),
      tx.contact.find({ tenantId, id: { $in: [...new Set(rows.map((r) => r.contactId))] } }, { projection: { id: 1, name: 1 } }),
    ]);
    const names = new Map(contacts.map((c) => [c.id, c.name]));
    const now = Date.now();
    return rows.map((r) => {
      const a = r.assigneeId ? refs.get(r.assigneeId) : undefined;
      return {
        id: r.id,
        number: r.number,
        subject: r.subject,
        type: r.type as CaseType,
        status: r.status as CaseStatus,
        priority: r.priority as TaskPriority,
        contact: { id: r.contactId, name: names.get(r.contactId) ?? "—" },
        assignee: a ? { id: a.id, name: a.name } : null,
        dueAt: r.dueAt.toISOString(),
        overdue: ACTIVE.includes(r.status as CaseStatus) && r.dueAt.getTime() < now,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  private async detail(tx: Tx, ctx: AuthedContext, r: ServiceCase): Promise<CaseDto> {
    const [[summary], refs, deal, order] = await Promise.all([
      this.summaries(tx, ctx.tenantId, [r]),
      memberRefs(tx, ctx.tenantId, r.notes.map((n) => n.authorId)),
      r.dealId ? tx.deal.findOne({ id: r.dealId, tenantId: ctx.tenantId }, { projection: { id: 1, title: 1 } }) : null,
      r.orderId ? tx.order.findOne({ id: r.orderId, tenantId: ctx.tenantId }, { projection: { id: 1, number: 1, title: 1 } }) : null,
    ]);
    return {
      ...summary!,
      description: r.description,
      deal: deal ? { id: deal.id, title: deal.title } : null,
      order: order ? { id: order.id, number: order.number, title: order.title } : null,
      warranty: r.warranty ? { until: r.warranty.until.toISOString(), valid: r.warranty.valid } : null,
      resolution: r.resolution,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      notes: r.notes.map((n) => {
        const a = n.authorId ? refs.get(n.authorId) : undefined;
        return { id: n.id, author: a ? { id: a.id, name: a.name } : null, body: n.body, at: n.at.toISOString() };
      }),
      canEdit: this.canEdit(ctx, r),
    };
  }
}
