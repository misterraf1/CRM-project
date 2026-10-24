import { Injectable, Logger } from "@nestjs/common";
import { MailService } from "../mail/mail.service";
import type { Channel, Conversation, Message, Prisma } from "@prisma/client";
import type {
  CannedResponseDto,
  CannedResponseInput,
  ConversationDetailDto,
  ConversationListItemDto,
  ConversationListQuery,
  ConversationUpdateInput,
  InboxMetricsDto,
  MessageDto,
  SendMessageInput,
} from "@axis/shared";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { sortNullsLast } from "../common/sort";
import { addDays, startOfDay } from "../common/time";
import { ActivityService } from "../crm/activity.service";
import { memberRefs, ownerScope } from "../crm/scope";
import { PrismaService, type Tx } from "../prisma/prisma.service";
import { InboxEvents } from "./events";
import { MetaClient } from "./meta.client";
import { openCredentials } from "../common/secrets";

const WHATSAPP_WINDOW_MS = 24 * 3600_000;
const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

type ConversationRow = Conversation & { channel: Channel; contact: { id: string; name: string } | null; messages: Message[] };

/**
 * Who sees a conversation: holders of inbox.view_all (owner, admin) everything;
 * managers their department's (assigned to a colleague or routed to the department)
 * plus unassigned ones to distribute; everyone else only what is assigned to them.
 */
export async function inboxScope(tx: Tx, ctx: AuthedContext): Promise<Prisma.ConversationWhereInput> {
  if (ctx.permissions.includes("inbox.view_all")) return {};
  if (ctx.role === "MANAGER") {
    const { memberIds } = await ownerScope(tx, ctx, "inbox.view_all");
    return {
      OR: [
        { assigneeId: { in: memberIds ?? [] } },
        { assigneeId: null },
        ...(ctx.departmentId ? [{ departmentId: ctx.departmentId }] : []),
      ],
    };
  }
  return { assigneeId: ctx.membershipId };
}

const INCLUDE = {
  channel: true,
  contact: { select: { id: true, name: true } },
  messages: { where: { direction: { not: "INTERNAL_NOTE" } }, orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.ConversationInclude;

@Injectable()
export class InboxService {
  private readonly logger = new Logger("Inbox");

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: InboxEvents,
    private readonly meta: MetaClient,
    private readonly activity: ActivityService,
    private readonly mail: MailService,
  ) {}

  async list(query: ConversationListQuery): Promise<ConversationListItemDto[]> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const scoped = await inboxScope(tx, ctx);
      const q = query.q?.trim();
      const rows = await tx.conversation.findMany({
        where: {
          AND: [
            { tenantId: ctx.tenantId },
            scoped,
            query.status === "ALL" ? {} : { status: query.status },
            query.assignee === "me" ? { assigneeId: ctx.membershipId } : query.assignee === "unassigned" ? { assigneeId: null } : {},
            query.channelId ? { channelId: query.channelId } : {},
            query.contactId ? { contactId: query.contactId } : {},
            q
              ? {
                  OR: [
                    { displayName: { contains: q, mode: "insensitive" } },
                    { handle: { contains: q, mode: "insensitive" } },
                    { contact: { name: { contains: q, mode: "insensitive" } } },
                    { messages: { some: { body: { contains: q, mode: "insensitive" } } } },
                  ],
                }
              : {},
          ],
        },
        include: INCLUDE,
        orderBy: { lastMessageAt: "desc" },
        take: 200,
      });
      // Longest-waiting first, then most recent activity (nulls last)
      const sorted = sortNullsLast(rows, [(c) => c.awaitingSince, "asc"], [(c) => c.lastMessageAt, "desc"]);
      return this.toListDtos(tx, ctx, sorted);
    });
  }

  async get(id: string): Promise<ConversationDetailDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const c = await this.findVisible(tx, ctx, id);
      const messages = await tx.message.findMany({ where: { tenantId: ctx.tenantId, conversationId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500 });
      const refs = await memberRefs(tx, ctx.tenantId, messages.map((m) => m.authorId));
      const [item] = await this.toListDtos(tx, ctx, [c]);
      return {
        ...item!,
        messages: messages.map((m): MessageDto => {
          const a = m.authorId ? refs.get(m.authorId) : undefined;
          return {
            id: m.id,
            direction: m.direction,
            body: m.body ?? "",
            author: a ? { id: a.id, name: a.name } : null,
            deliveryStatus: m.deliveryStatus,
            createdAt: m.createdAt.toISOString(),
          };
        }),
        firstResponseMs: c.firstResponseMs,
        replyWindowEndsAt:
          c.channel.type === "WHATSAPP" && !c.channel.demo && c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + WHATSAPP_WINDOW_MS).toISOString() : null,
        can: { reply: ctx.permissions.includes("inbox.reply"), assign: ctx.permissions.includes("inbox.assign") },
      };
    });
  }

  /**
   * Customer reply or internal note. The message is stored first (status "pending"),
   * then sent to the provider outside the transaction; the status records the outcome.
   */
  async send(id: string, input: SendMessageInput): Promise<MessageDto> {
    const ctx = authedContext();
    if (!ctx.permissions.includes("inbox.reply")) throw forbidden("Replying needs the inbox.reply permission");

    const { message, channel, conversation } = await this.prisma.scoped(async (tx) => {
      const c = await this.findVisible(tx, ctx, id);
      if (!input.internal && c.channel.status === "disconnected") throw new AppError("CHANNEL_ERROR", "Channel is disconnected");
      if (!input.internal && c.channel.type === "WHATSAPP" && !c.channel.demo) {
        const open = c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < WHATSAPP_WINDOW_MS;
        if (!open) throw new AppError("WINDOW_CLOSED", "WhatsApp allows free-form replies only within 24 h of the customer's last message");
      }
      const now = new Date();
      const message = await tx.message.create({
        data: {
          tenantId: ctx.tenantId,
          conversationId: id,
          direction: input.internal ? "INTERNAL_NOTE" : "OUTBOUND",
          authorId: ctx.membershipId,
          body: input.body,
          // Email replies wait in the mail queue; the sender updates the status
          deliveryStatus: input.internal ? null : c.channel.demo ? "demo" : c.channel.type === "WEBCHAT" ? "sent" : c.channel.type === "EMAIL" ? "queued" : "pending",
          createdAt: now,
        },
      });
      if (!input.internal && c.channel.type === "EMAIL" && !c.channel.demo && c.handle) {
        await this.queueEmailReply(tx, c, input.body, message.id);
      }
      if (!input.internal) {
        await tx.conversation.update({
          where: { id },
          data: {
            lastMessageAt: now,
            awaitingSince: null,
            unreadCount: 0,
            // First reply sets the response-time metric and claims an unassigned conversation
            ...(c.firstResponseMs === null ? { firstResponseMs: now.getTime() - c.createdAt.getTime() } : {}),
            ...(c.assigneeId ? {} : { assigneeId: ctx.membershipId }),
          },
        });
      }
      return { message, channel: c.channel, conversation: c };
    });

    let status = message.deliveryStatus;
    if (status === "pending") {
      try {
        const token = openCredentials(channel.credentials!).accessToken!;
        const externalId =
          channel.type === "WHATSAPP"
            ? await this.meta.sendWhatsApp(channel.externalId, token, conversation.externalThread, input.body)
            : await this.meta.sendPageMessage(token, conversation.externalThread, input.body);
        status = "sent";
        await this.prisma.scoped((tx) => tx.message.update({ where: { id: message.id }, data: { deliveryStatus: status, externalId: externalId || null } }));
      } catch (e) {
        status = "failed";
        this.logger.warn(`Send failed for conversation ${id}: ${e instanceof Error ? e.message : e}`);
        await this.prisma.scoped((tx) => tx.message.update({ where: { id: message.id }, data: { deliveryStatus: status } }));
      }
    }

    this.events.publish(ctx.tenantId, { type: "message", conversationId: id, direction: message.direction });
    const me = (await this.prisma.scoped((tx) => memberRefs(tx, ctx.tenantId, [ctx.membershipId]))).get(ctx.membershipId);
    return {
      id: message.id,
      direction: message.direction,
      body: input.body,
      author: me ? { id: me.id, name: me.name } : null,
      deliveryStatus: status,
      createdAt: message.createdAt.toISOString(),
    };
  }

  async update(id: string, input: ConversationUpdateInput): Promise<ConversationListItemDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      await this.findVisible(tx, ctx, id);
      const routing = input.assigneeId !== undefined || input.departmentId !== undefined;
      if (routing && !ctx.permissions.includes("inbox.assign")) throw forbidden("Assigning needs the inbox.assign permission");
      if (input.status && !ctx.permissions.includes("inbox.reply")) throw forbidden("Not allowed");
      if (input.assigneeId && !(await tx.membership.count({ where: { id: input.assigneeId, tenantId: ctx.tenantId, status: "ACTIVE" } }))) {
        throw new AppError("VALIDATION_FAILED", "Unknown assignee", { assigneeId: ["Unknown member"] });
      }
      if (input.departmentId && !(await tx.department.count({ where: { id: input.departmentId, tenantId: ctx.tenantId } }))) {
        throw new AppError("VALIDATION_FAILED", "Unknown department", { departmentId: ["Unknown department"] });
      }
      const updated = await tx.conversation.update({
        where: { id },
        data: {
          status: input.status,
          assigneeId: input.assigneeId,
          departmentId: input.departmentId,
          // Forwarding to a department without a person puts it back in the department's queue
          ...(input.departmentId && input.assigneeId === undefined ? { assigneeId: null } : {}),
          ...(input.status === "RESOLVED" ? { awaitingSince: null, unreadCount: 0 } : {}),
        },
        include: INCLUDE,
      });
      this.events.publish(ctx.tenantId, { type: "conversation", conversationId: id });
      return (await this.toListDtos(tx, ctx, [updated]))[0]!;
    });
  }

  async markRead(id: string) {
    const ctx = authedContext();
    await this.prisma.scoped(async (tx) => {
      await this.findVisible(tx, ctx, id);
      await tx.conversation.update({ where: { id }, data: { unreadCount: 0 } });
    });
  }

  /** Adds the customer to the CRM (or links an existing contact) straight from the conversation. */
  async linkContact(id: string, input: { contactId?: string; name?: string }) {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const c = await this.findVisible(tx, ctx, id);
      let contactId = input.contactId;
      if (contactId) {
        const { where } = await ownerScope(tx, ctx, "contacts.view_all");
        if (!(await tx.contact.count({ where: { AND: [{ id: contactId, tenantId: ctx.tenantId, deletedAt: null }, where] } }))) {
          throw new AppError("VALIDATION_FAILED", "Unknown contact", { contactId: ["Unknown contact"] });
        }
      } else {
        const isEmail = c.handle?.includes("@");
        const isPhone = c.handle && /^\+?\d{7,15}$/.test(c.handle.replace(/[\s()-]/g, ""));
        const created = await tx.contact.create({
          data: {
            tenantId: ctx.tenantId,
            name: input.name ?? c.displayName ?? c.handle ?? "Ziyarətçi",
            phone: isPhone ? `+${c.handle!.replace(/[^\d]/g, "")}` : null,
            email: isEmail ? c.handle!.toLowerCase() : null,
            source: c.channel.type === "WEBCHAT" ? "website" : c.channel.type.toLowerCase(),
            ownerId: ctx.membershipId,
          },
        });
        await this.activity.record(tx, { type: "contact_created", contactId: created.id, payload: { contactName: created.name } });
        contactId = created.id;
      }
      await tx.conversation.update({ where: { id }, data: { contactId } });
      return { contactId };
    });
  }

  async templates(): Promise<CannedResponseDto[]> {
    const { tenantId } = authedContext();
    const rows = await this.prisma.scoped((tx) => tx.cannedResponse.findMany({ where: { tenantId }, orderBy: { shortcut: "asc" } }));
    return rows.map((r) => ({ id: r.id, shortcut: r.shortcut, body: r.body }));
  }

  async createTemplate(input: CannedResponseInput): Promise<CannedResponseDto> {
    const ctx = authedContext();
    const r = await this.prisma.scoped((tx) => tx.cannedResponse.create({ data: { tenantId: ctx.tenantId, shortcut: input.shortcut, body: input.body, ownerId: ctx.membershipId } }));
    return { id: r.id, shortcut: r.shortcut, body: r.body };
  }

  async deleteTemplate(id: string) {
    const { tenantId } = authedContext();
    await this.prisma.scoped(async (tx) => {
      const res = await tx.cannedResponse.deleteMany({ where: { id, tenantId } });
      if (!res.count) throw notFound("Template");
    });
  }

  async metrics(period: keyof typeof PERIOD_DAYS): Promise<InboxMetricsDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true } });
      const start = addDays(startOfDay(new Date(), tenant.timezone), -(PERIOD_DAYS[period] - 1), tenant.timezone);
      return computeInboxMetrics(tx, ctx, start);
    });
  }

  /** Email channel: the reply leaves from the channel's address, threaded under the customer's email. */
  private async queueEmailReply(tx: Tx, c: ConversationRow, body: string, messageId: string) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { name: true } });
    const address = ((c.channel.settings ?? {}) as { address?: string }).address ?? c.channel.externalId;
    const base = c.subject?.trim() || tenant.name;
    const subject = /^re:/i.test(base) ? base : `Re: ${base}`;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    await this.mail.queue(tx, {
      tenantId: c.tenantId,
      to: c.handle!,
      from: `"${tenant.name.replace(/"/g, "")}" <${address}>`,
      headers: c.emailReplyTo ? { "In-Reply-To": c.emailReplyTo, References: c.emailReplyTo } : {},
      raw: {
        subject,
        text: body,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(body)}</div>`,
      },
      inboxMessageId: messageId,
    });
  }

  async findVisible(tx: Tx, ctx: AuthedContext, id: string): Promise<ConversationRow> {
    const scoped = await inboxScope(tx, ctx);
    const c = await tx.conversation.findFirst({ where: { AND: [{ id, tenantId: ctx.tenantId }, scoped] }, include: INCLUDE });
    if (!c) throw notFound("Conversation");
    return c;
  }

  private async toListDtos(tx: Tx, ctx: AuthedContext, rows: ConversationRow[]): Promise<ConversationListItemDto[]> {
    const refs = await memberRefs(tx, ctx.tenantId, rows.map((r) => r.assigneeId));
    return rows.map((c) => {
      const a = c.assigneeId ? refs.get(c.assigneeId) : undefined;
      const last = c.messages[0];
      return {
        id: c.id,
        channel: { id: c.channel.id, type: c.channel.type, name: c.channel.name, demo: c.channel.demo },
        contact: c.contact,
        // Empty for anonymous website visitors; the UI shows a localized "Visitor"
        displayName: c.contact?.name ?? c.displayName ?? c.handle ?? "",
        handle: c.handle ?? "",
        status: c.status,
        assignee: a ? { id: a.id, name: a.name } : null,
        departmentId: c.departmentId,
        unreadCount: c.unreadCount,
        awaitingSince: c.awaitingSince?.toISOString() ?? null,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        lastMessage: last ? { body: (last.body ?? "").slice(0, 160), direction: last.direction } : null,
      };
    });
  }
}

/** Shared by the inbox metrics endpoint and the dashboard. */
export async function computeInboxMetrics(tx: Tx, ctx: AuthedContext, start: Date): Promise<InboxMetricsDto> {
  const scoped = await inboxScope(tx, ctx);
  const base = { AND: [{ tenantId: ctx.tenantId }, scoped] };
  const [awaitingAgg, answered, byChannel] = await Promise.all([
    tx.conversation.aggregate({ where: { AND: [...base.AND, { awaitingSince: { not: null }, status: { not: "RESOLVED" } }] }, _count: true, _min: { awaitingSince: true } }),
    tx.conversation.findMany({
      where: { AND: [...base.AND, { firstResponseMs: { not: null }, createdAt: { gte: start } }] },
      select: { assigneeId: true, firstResponseMs: true },
    }),
    tx.conversation.findMany({ where: { AND: [...base.AND, { createdAt: { gte: start } }] }, select: { channel: { select: { type: true } } } }),
  ]);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 60_000) : null);
  const groups = new Map<string, number[]>();
  for (const r of answered) if (r.assigneeId) groups.set(r.assigneeId, [...(groups.get(r.assigneeId) ?? []), r.firstResponseMs!]);
  const refs = await memberRefs(tx, ctx.tenantId, [...groups.keys()]);
  const channels = new Map<string, number>();
  for (const r of byChannel) channels.set(r.channel.type, (channels.get(r.channel.type) ?? 0) + 1);
  return {
    awaiting: awaitingAgg._count,
    longestWaitMin: awaitingAgg._min.awaitingSince ? Math.round((Date.now() - awaitingAgg._min.awaitingSince.getTime()) / 60_000) : null,
    avgFirstResponseMin: avg(answered.map((r) => r.firstResponseMs!)),
    byMember: [...groups].map(([id, xs]) => ({ member: { id, name: refs.get(id)?.name ?? "" }, conversations: xs.length, avgFirstResponseMin: avg(xs) })),
    byChannel: [...channels].map(([type, conversations]) => ({ type: type as InboxMetricsDto["byChannel"][number]["type"], conversations })),
  };
}
