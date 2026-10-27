import type { Plan, Subscription, SupportTicket, SupportTicketMessage } from "../db/models";
import type { TicketCreateInput, TicketDto, TicketMessageDto, TicketPriority, TicketStatus } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { config } from "../config";
import { MailService } from "../mail/mail.service";
import { EntitlementsService } from "../billing/entitlements.service";
import { authedContext, currentContext } from "../common/context";
import { notFound } from "../common/errors";
import { NotificationsService } from "../notifications/notifications.service";
import type { Database, Tx } from "../db/database";
import type { Filter } from "../db/repo";

type Ticket = SupportTicket & { messages?: SupportTicketMessage[] };

/**
 * Support tickets between a company and the platform team.
 * Company side: everyone files tickets; the author sees theirs, owners and admins see
 * all of the company's. Platform side (admin controller): every company, via system().
 */
export class SupportService {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly mail: MailService,
  ) {}

  /** Plans with "support.priority" are answered first (the trial includes it, like every feature). */
  private tenantRef(t: { id: string; name: string; subscription: (Subscription & { plan: Plan }) | null }) {
    const sub = t.subscription;
    return { id: t.id, name: t.name, plan: sub?.plan.code ?? "—", prioritySupport: !!sub && this.entitlements.features(sub).includes("support.priority") };
  }

  private async names(tx: Tx, userIds: string[]) {
    const users = await tx.user.find({ id: { $in: [...new Set(userIds)] } }, { projection: { id: 1, fullName: 1 } });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  /** Companies of the tickets with their subscription and plan (platform side). */
  private async tenants(tx: Tx, tenantIds: string[]) {
    const ids = [...new Set(tenantIds)];
    const [tenants, subs] = await Promise.all([tx.tenant.find({ id: { $in: ids } }, { projection: { id: 1, name: 1 } }), tx.subscription.find({ tenantId: { $in: ids } })]);
    const plans = new Map((await tx.plan.find({ id: { $in: [...new Set(subs.map((s) => s.planId))] } })).map((p) => [p.id, p]));
    const subOf = new Map(subs.map((sub) => [sub.tenantId, plans.has(sub.planId) ? { ...sub, plan: plans.get(sub.planId)! } : null]));
    return new Map(tenants.map((t) => [t.id, this.tenantRef({ id: t.id, name: t.name, subscription: subOf.get(t.id) ?? null })]));
  }

  private async lastMessages(tx: Tx, ticketIds: string[]) {
    const rows = await Promise.all(ticketIds.map((ticketId) => tx.supportTicketMessage.findOne({ ticketId }, { sort: { createdAt: -1 } })));
    return new Map(ticketIds.map((id, i) => [id, rows[i] ? [rows[i]!] : []]));
  }

  private dto(t: Ticket, names: Map<string, string>, extra: Partial<TicketDto> = {}): TicketDto {
    const last = t.messages?.at(-1);
    return {
      id: t.id,
      subject: t.subject,
      status: t.status as TicketStatus,
      priority: t.priority as TicketPriority,
      author: names.get(t.authorId) ?? "—",
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      ...(last ? { lastMessageFromStaff: last.fromStaff } : {}),
      ...extra,
    };
  }

  private messageDto(m: SupportTicketMessage, names: Map<string, string>, staffLabel: string): TicketMessageDto {
    return { id: m.id, body: m.body, fromStaff: m.fromStaff, author: m.fromStaff ? staffLabel : (names.get(m.authorId) ?? "—"), createdAt: m.createdAt.toISOString() };
  }

  /** Owners and admins see every ticket of the company; others only their own. */
  private visible(): Filter {
    const ctx = authedContext();
    return ctx.role === "OWNER" || ctx.role === "ADMIN" ? { tenantId: ctx.tenantId } : { tenantId: ctx.tenantId, authorId: ctx.userId };
  }

  // ── Company side ──

  async list(): Promise<TicketDto[]> {
    return this.db.scoped(async (tx) => {
      const rows = await tx.supportTicket.find(this.visible(), { sort: { updatedAt: -1 }, limit: 100 });
      const [names, last] = await Promise.all([this.names(tx, rows.map((r) => r.authorId)), this.lastMessages(tx, rows.map((r) => r.id))]);
      return rows.map((r) => this.dto({ ...r, messages: last.get(r.id) }, names));
    });
  }

  async create(input: TicketCreateInput): Promise<TicketDto> {
    const ctx = authedContext();
    const id = await this.db.scoped(async (tx) => {
      const t = await tx.supportTicket.insertOne({ tenantId: ctx.tenantId, authorId: ctx.userId, subject: input.subject, body: input.body, priority: input.priority });
      // The first message is the ticket body, so the thread reads top to bottom
      await tx.supportTicketMessage.insertOne({ tenantId: ctx.tenantId, ticketId: t.id, authorId: ctx.userId, body: input.body });
      await this.audit.log(tx, { action: "support.ticket_created", entityType: "ticket", entityId: t.id });
      return t.id;
    });
    return this.get(id);
  }

  async get(id: string, staffLabel = "Axis"): Promise<TicketDto> {
    return this.db.scoped(async (tx) => {
      const t = await tx.supportTicket.findOne({ id, ...this.visible() });
      if (!t) throw notFound("Ticket");
      const messages = await tx.supportTicketMessage.find({ ticketId: id }, { sort: { createdAt: 1 } });
      const names = await this.names(tx, [t.authorId, ...messages.map((m) => m.authorId)]);
      return this.dto({ ...t, messages }, names, { messages: messages.map((m) => this.messageDto(m, names, staffLabel)) });
    });
  }

  /** A company reply reopens a ticket support had closed. */
  async reply(id: string, body: string): Promise<TicketDto> {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const t = await tx.supportTicket.findOne({ id, ...this.visible() });
      if (!t) throw notFound("Ticket");
      await tx.supportTicketMessage.insertOne({ tenantId: ctx.tenantId, ticketId: id, authorId: ctx.userId, body });
      await tx.supportTicket.update({ id }, { $set: { status: t.status === "closed" ? "open" : t.status } });
    });
    return this.get(id);
  }

  // ── Platform side (all companies) ──

  async adminList(q: { status?: TicketStatus }): Promise<TicketDto[]> {
    const db = this.db.system;
    const rows = await db.supportTicket.find(q.status ? { status: q.status } : { status: { $ne: "closed" } }, { sort: { updatedAt: -1 }, limit: 200 });
    const [names, last, tenants] = await Promise.all([
      this.names(db, rows.map((r) => r.authorId)),
      this.lastMessages(db, rows.map((r) => r.id)),
      this.tenants(db, rows.map((r) => r.tenantId)),
    ]);
    const tickets = rows.map((r) => this.dto({ ...r, messages: last.get(r.id) }, names, { tenant: tenants.get(r.tenantId) }));
    // Priority-plan companies first among unresolved tickets; otherwise most recent first
    const rank = (t: TicketDto) => (t.status !== "closed" && t.tenant?.prioritySupport ? 0 : 1);
    return tickets.sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt));
  }

  async adminGet(id: string): Promise<TicketDto> {
    const db = this.db.system;
    const t = await db.supportTicket.findOne({ id });
    if (!t) throw notFound("Ticket");
    const messages = await db.supportTicketMessage.find({ ticketId: id }, { sort: { createdAt: 1 } });
    const [names, tenants] = await Promise.all([this.names(db, [t.authorId, ...messages.map((m) => m.authorId)]), this.tenants(db, [t.tenantId])]);
    return this.dto({ ...t, messages }, names, {
      tenant: tenants.get(t.tenantId),
      // Staff see who on the team answered; companies see "Axis"
      messages: messages.map((m) => ({ ...this.messageDto(m, names, ""), author: names.get(m.authorId) ?? "—" })),
    });
  }

  /** Staff reply: moves an open ticket to in-progress and notifies the author in-app. */
  async adminReply(id: string, body: string): Promise<TicketDto> {
    const staffId = currentContext().userId!;
    await this.db.systemTx(async (tx) => {
      const t = await tx.supportTicket.findOne({ id });
      if (!t) throw notFound("Ticket");
      await tx.supportTicketMessage.insertOne({ tenantId: t.tenantId, ticketId: id, authorId: staffId, fromStaff: true, body });
      await tx.supportTicket.update({ id }, { $set: { status: t.status === "open" ? "in_progress" : t.status } });
      const author = await tx.membership.findOne({ tenantId: t.tenantId, userId: t.authorId, status: "ACTIVE" }, { projection: { id: 1 } });
      await this.notifications.notify(tx, t.tenantId, [author?.id], "support_reply", { ticketId: id, title: t.subject });
      const user = await tx.user.findOne({ id: t.authorId }, { projection: { email: 1, locale: 1 } });
      if (author && user) {
        await this.mail.queue(tx, {
          tenantId: t.tenantId,
          to: user.email,
          locale: user.locale,
          template: "support_reply",
          vars: { subject: t.subject, link: `${config().WEB_ORIGIN}/support/${id}` },
        });
      }
      await this.audit.log(tx, { action: "platform.ticket_replied", entityType: "ticket", entityId: id, tenantId: t.tenantId });
    });
    return this.adminGet(id);
  }

  async adminUpdate(id: string, input: { status?: TicketStatus; priority?: TicketPriority }): Promise<TicketDto> {
    await this.db.systemTx(async (tx) => {
      const t = await tx.supportTicket.findOne({ id });
      if (!t) throw notFound("Ticket");
      await tx.supportTicket.update({ id }, { $set: input });
      await this.audit.log(tx, { action: "platform.ticket_updated", entityType: "ticket", entityId: id, tenantId: t.tenantId, diff: input });
    });
    return this.adminGet(id);
  }
}
