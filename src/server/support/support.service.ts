import { Injectable } from "@nestjs/common";
import type { Plan, Prisma, Subscription, SupportTicket, SupportTicketMessage } from "@prisma/client";
import type { TicketCreateInput, TicketDto, TicketMessageDto, TicketPriority, TicketStatus } from "@axis/shared";
import { AuditService } from "../audit/audit.service";
import { config } from "../config";
import { MailService } from "../mail/mail.service";
import { EntitlementsService } from "../billing/entitlements.service";
import { authedContext, currentContext } from "../common/context";
import { notFound } from "../common/errors";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService, type Tx } from "../prisma/prisma.service";

type Ticket = SupportTicket & { messages?: SupportTicketMessage[] };

/**
 * Support tickets between a company and the platform team.
 * Company side: everyone files tickets; the author sees theirs, owners and admins see
 * all of the company's. Platform side (admin controller): every company, via system().
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
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

  private async names(tx: Tx | PrismaService, userIds: string[]) {
    const users = await tx.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u.fullName]));
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
  private visible(): Prisma.SupportTicketWhereInput {
    const ctx = authedContext();
    return ctx.role === "OWNER" || ctx.role === "ADMIN" ? { tenantId: ctx.tenantId } : { tenantId: ctx.tenantId, authorId: ctx.userId };
  }

  // ── Company side ──

  async list(): Promise<TicketDto[]> {
    return this.prisma.scoped(async (tx) => {
      const rows = await tx.supportTicket.findMany({ where: this.visible(), orderBy: { updatedAt: "desc" }, take: 100, include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } } });
      const names = await this.names(tx, rows.map((r) => r.authorId));
      return rows.map((r) => this.dto({ ...r, messages: r.messages.reverse() }, names));
    });
  }

  async create(input: TicketCreateInput): Promise<TicketDto> {
    const ctx = authedContext();
    const id = await this.prisma.scoped(async (tx) => {
      const t = await tx.supportTicket.create({ data: { tenantId: ctx.tenantId, authorId: ctx.userId, subject: input.subject, body: input.body, priority: input.priority } });
      // The first message is the ticket body, so the thread reads top to bottom
      await tx.supportTicketMessage.create({ data: { tenantId: ctx.tenantId, ticketId: t.id, authorId: ctx.userId, body: input.body } });
      await this.audit.log(tx, { action: "support.ticket_created", entityType: "ticket", entityId: t.id });
      return t.id;
    });
    return this.get(id);
  }

  async get(id: string, staffLabel = "Axis"): Promise<TicketDto> {
    return this.prisma.scoped(async (tx) => {
      const t = await tx.supportTicket.findFirst({ where: { id, ...this.visible() }, include: { messages: { orderBy: { createdAt: "asc" } } } });
      if (!t) throw notFound("Ticket");
      const names = await this.names(tx, [t.authorId, ...t.messages.map((m) => m.authorId)]);
      return this.dto(t, names, { messages: t.messages.map((m) => this.messageDto(m, names, staffLabel)) });
    });
  }

  /** A company reply reopens a ticket support had closed. */
  async reply(id: string, body: string): Promise<TicketDto> {
    const ctx = authedContext();
    await this.prisma.scoped(async (tx) => {
      const t = await tx.supportTicket.findFirst({ where: { id, ...this.visible() } });
      if (!t) throw notFound("Ticket");
      await tx.supportTicketMessage.create({ data: { tenantId: ctx.tenantId, ticketId: id, authorId: ctx.userId, body } });
      await tx.supportTicket.update({ where: { id }, data: { status: t.status === "closed" ? "open" : t.status } });
    });
    return this.get(id);
  }

  // ── Platform side (all companies) ──

  async adminList(q: { status?: TicketStatus }): Promise<TicketDto[]> {
    return this.prisma.system(async () => {
      const rows = await this.prisma.supportTicket.findMany({
        where: q.status ? { status: q.status } : { status: { not: "closed" } },
        orderBy: { updatedAt: "desc" },
        take: 200,
        include: { messages: { orderBy: { createdAt: "desc" }, take: 1 }, tenant: { include: { subscription: { include: { plan: true } } } } },
      });
      const names = await this.names(this.prisma, rows.map((r) => r.authorId));
      const tickets = rows.map((r) => this.dto({ ...r, messages: r.messages.reverse() }, names, { tenant: this.tenantRef(r.tenant) }));
      // Priority-plan companies first among unresolved tickets; otherwise most recent first
      const rank = (t: TicketDto) => (t.status !== "closed" && t.tenant?.prioritySupport ? 0 : 1);
      return tickets.sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  async adminGet(id: string): Promise<TicketDto> {
    return this.prisma.system(async () => {
      const t = await this.prisma.supportTicket.findUnique({
        where: { id },
        include: { messages: { orderBy: { createdAt: "asc" } }, tenant: { include: { subscription: { include: { plan: true } } } } },
      });
      if (!t) throw notFound("Ticket");
      const names = await this.names(this.prisma, [t.authorId, ...t.messages.map((m) => m.authorId)]);
      return this.dto(t, names, {
        tenant: this.tenantRef(t.tenant),
        // Staff see who on the team answered; companies see "Axis"
        messages: t.messages.map((m) => ({ ...this.messageDto(m, names, ""), author: names.get(m.authorId) ?? "—" })),
      });
    });
  }

  /** Staff reply: moves an open ticket to in-progress and notifies the author in-app. */
  async adminReply(id: string, body: string): Promise<TicketDto> {
    const staffId = currentContext().userId!;
    await this.prisma.systemTx(async (tx) => {
      const t = await tx.supportTicket.findUnique({ where: { id } });
      if (!t) throw notFound("Ticket");
      await tx.supportTicketMessage.create({ data: { tenantId: t.tenantId, ticketId: id, authorId: staffId, fromStaff: true, body } });
      await tx.supportTicket.update({ where: { id }, data: { status: t.status === "open" ? "in_progress" : t.status } });
      const author = await tx.membership.findFirst({ where: { tenantId: t.tenantId, userId: t.authorId, status: "ACTIVE" }, select: { id: true } });
      await this.notifications.notify(tx, t.tenantId, [author?.id], "support_reply", { ticketId: id, title: t.subject });
      const user = await tx.user.findUnique({ where: { id: t.authorId }, select: { email: true, locale: true } });
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
    await this.prisma.systemTx(async (tx) => {
      const t = await tx.supportTicket.findUnique({ where: { id } });
      if (!t) throw notFound("Ticket");
      await tx.supportTicket.update({ where: { id }, data: input });
      await this.audit.log(tx, { action: "platform.ticket_updated", entityType: "ticket", entityId: id, tenantId: t.tenantId, diff: input });
    });
    return this.adminGet(id);
  }
}
