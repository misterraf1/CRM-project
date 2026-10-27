import { Logger } from "../common/logger";
import { MailService } from "../mail/mail.service";
import type { Channel, Conversation, Message } from "../db/models";
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
} from "@/shared";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { sortNullsLast } from "../common/sort";
import { addDays, startOfDay } from "../common/time";
import { ActivityService } from "../crm/activity.service";
import { memberRefs, ownerScope } from "../crm/scope";
import type { Database, Tx } from "../db/database";
import { and, contains } from "../db/query";
import type { Filter } from "../db/repo";
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
export async function inboxScope(tx: Tx, ctx: AuthedContext): Promise<Filter> {
  if (ctx.permissions.includes("inbox.view_all")) return {};
  if (ctx.role === "MANAGER") {
    const { memberIds } = await ownerScope(tx, ctx, "inbox.view_all");
    return {
      $or: [
        { assigneeId: { $in: memberIds ?? [] } },
        { assigneeId: null },
        ...(ctx.departmentId ? [{ departmentId: ctx.departmentId }] : []),
      ],
    };
  }
  return { assigneeId: ctx.membershipId };
}

/** Conversations with their channel, contact and last customer-facing message. */
async function withRelations(tx: Tx, tenantId: string, rows: Conversation[]): Promise<ConversationRow[]> {
  if (!rows.length) return [];
  const contactIds = [...new Set(rows.map((c) => c.contactId).filter((x): x is string => !!x))];
  const [channels, contacts, last] = await Promise.all([
    tx.channel.find({ tenantId, id: { $in: [...new Set(rows.map((c) => c.channelId))] } }),
    contactIds.length ? tx.contact.find({ tenantId, id: { $in: contactIds } }, { projection: { id: 1, name: 1 } }) : [],
    Promise.all(rows.map((c) => tx.message.findOne({ tenantId, conversationId: c.id, direction: { $ne: "INTERNAL_NOTE" } }, { sort: { createdAt: -1 } }))),
  ]);
  const channelById = new Map(channels.map((ch) => [ch.id, ch]));
  const contactById = new Map(contacts.map((ct) => [ct.id, { id: ct.id, name: ct.name }]));
  return rows.map((c, i) => ({
    ...c,
    channel: channelById.get(c.channelId)!,
    contact: (c.contactId && contactById.get(c.contactId)) || null,
    messages: last[i] ? [last[i]!] : [],
  }));
}

export class InboxService {
  private readonly logger = new Logger("Inbox");

  constructor(
    private readonly db: Database,
    private readonly events: InboxEvents,
    private readonly meta: MetaClient,
    private readonly activity: ActivityService,
    private readonly mail: MailService,
  ) {}

  async list(query: ConversationListQuery): Promise<ConversationListItemDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const scoped = await inboxScope(tx, ctx);
      const q = query.q?.trim();
      const [byContact, byMessage] = q
        ? await Promise.all([
            tx.contact.find({ tenantId: ctx.tenantId, name: contains(q) }, { projection: { id: 1 } }).then((r) => r.map((c) => c.id)),
            tx.message.distinct<string>("conversationId", { tenantId: ctx.tenantId, body: contains(q) }),
          ])
        : [[], []];
      const found = await tx.conversation.find(
        and(
          { tenantId: ctx.tenantId },
          scoped,
          query.status === "ALL" ? {} : { status: query.status },
          query.assignee === "me" ? { assigneeId: ctx.membershipId } : query.assignee === "unassigned" ? { assigneeId: null } : {},
          query.channelId ? { channelId: query.channelId } : {},
          query.contactId ? { contactId: query.contactId } : {},
          q
            ? { $or: [{ displayName: contains(q) }, { handle: contains(q) }, { contactId: { $in: byContact } }, { id: { $in: byMessage } }] }
            : {},
        ),
        { sort: { lastMessageAt: -1 }, limit: 200 },
      );
      const rows = await withRelations(tx, ctx.tenantId, found);
      // Longest-waiting first, then most recent activity (nulls last)
      const sorted = sortNullsLast(rows, [(c) => c.awaitingSince, "asc"], [(c) => c.lastMessageAt, "desc"]);
      return this.toListDtos(tx, ctx, sorted);
    });
  }

  async get(id: string): Promise<ConversationDetailDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const c = await this.findVisible(tx, ctx, id);
      const messages = await tx.message.find({ tenantId: ctx.tenantId, conversationId: id }, { sort: { createdAt: 1, id: 1 }, limit: 500 });
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

    const { message, channel, conversation } = await this.db.scoped(async (tx) => {
      const c = await this.findVisible(tx, ctx, id);
      if (!input.internal && c.channel.status === "disconnected") throw new AppError("CHANNEL_ERROR", "Channel is disconnected");
      if (!input.internal && c.channel.type === "WHATSAPP" && !c.channel.demo) {
        const open = c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < WHATSAPP_WINDOW_MS;
        if (!open) throw new AppError("WINDOW_CLOSED", "WhatsApp allows free-form replies only within 24 h of the customer's last message");
      }
      const now = new Date();
      const message = await tx.message.insertOne({
          tenantId: ctx.tenantId,
          conversationId: id,
          direction: input.internal ? "INTERNAL_NOTE" : "OUTBOUND",
          authorId: ctx.membershipId,
          body: input.body,
          // Email replies wait in the mail queue; the sender updates the status
          deliveryStatus: input.internal ? null : c.channel.demo ? "demo" : c.channel.type === "WEBCHAT" ? "sent" : c.channel.type === "EMAIL" ? "queued" : "pending",
          createdAt: now,
      });
      if (!input.internal && c.channel.type === "EMAIL" && !c.channel.demo && c.handle) {
        await this.queueEmailReply(tx, c, input.body, message.id);
      }
      if (!input.internal) {
        await tx.conversation.update(
          { id },
          {
            $set: {
              lastMessageAt: now,
              awaitingSince: null,
              unreadCount: 0,
              // First reply sets the response-time metric and claims an unassigned conversation
              ...(c.firstResponseMs === null ? { firstResponseMs: now.getTime() - c.createdAt.getTime() } : {}),
              ...(c.assigneeId ? {} : { assigneeId: ctx.membershipId }),
            },
          },
        );
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
        await this.db.scoped((tx) => tx.message.update({ id: message.id }, { $set: { deliveryStatus: status, externalId: externalId || null } }));
      } catch (e) {
        status = "failed";
        this.logger.warn(`Send failed for conversation ${id}: ${e instanceof Error ? e.message : e}`);
        await this.db.scoped((tx) => tx.message.update({ id: message.id }, { $set: { deliveryStatus: status } }));
      }
    }

    this.events.publish(ctx.tenantId, { type: "message", conversationId: id, direction: message.direction });
    const me = (await this.db.scoped((tx) => memberRefs(tx, ctx.tenantId, [ctx.membershipId]))).get(ctx.membershipId);
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
    return this.db.scoped(async (tx) => {
      await this.findVisible(tx, ctx, id);
      const routing = input.assigneeId !== undefined || input.departmentId !== undefined;
      if (routing && !ctx.permissions.includes("inbox.assign")) throw forbidden("Assigning needs the inbox.assign permission");
      if (input.status && !ctx.permissions.includes("inbox.reply")) throw forbidden("Not allowed");
      if (input.assigneeId && !(await tx.membership.count({ id: input.assigneeId, tenantId: ctx.tenantId, status: "ACTIVE" }))) {
        throw new AppError("VALIDATION_FAILED", "Unknown assignee", { assigneeId: ["Unknown member"] });
      }
      if (input.departmentId && !(await tx.department.count({ id: input.departmentId, tenantId: ctx.tenantId }))) {
        throw new AppError("VALIDATION_FAILED", "Unknown department", { departmentId: ["Unknown department"] });
      }
      const updated = await tx.conversation.update(
        { id },
        {
          $set: {
            status: input.status,
            assigneeId: input.assigneeId,
            departmentId: input.departmentId,
            // Forwarding to a department without a person puts it back in the department's queue
            ...(input.departmentId && input.assigneeId === undefined ? { assigneeId: null } : {}),
            ...(input.status === "RESOLVED" ? { awaitingSince: null, unreadCount: 0 } : {}),
          },
        },
      );
      this.events.publish(ctx.tenantId, { type: "conversation", conversationId: id });
      return (await this.toListDtos(tx, ctx, await withRelations(tx, ctx.tenantId, [updated])))[0]!;
    });
  }

  async markRead(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      await this.findVisible(tx, ctx, id);
      await tx.conversation.update({ id }, { $set: { unreadCount: 0 } });
    });
  }

  /** Adds the customer to the CRM (or links an existing contact) straight from the conversation. */
  async linkContact(id: string, input: { contactId?: string; name?: string }) {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const c = await this.findVisible(tx, ctx, id);
      let contactId = input.contactId;
      if (contactId) {
        const { where } = await ownerScope(tx, ctx, "contacts.view_all");
        if (!(await tx.contact.count(and({ id: contactId, tenantId: ctx.tenantId, deletedAt: null }, where)))) {
          throw new AppError("VALIDATION_FAILED", "Unknown contact", { contactId: ["Unknown contact"] });
        }
      } else {
        const isEmail = c.handle?.includes("@");
        const isPhone = c.handle && /^\+?\d{7,15}$/.test(c.handle.replace(/[\s()-]/g, ""));
        const created = await tx.contact.insertOne({
          tenantId: ctx.tenantId,
          name: input.name ?? c.displayName ?? c.handle ?? "Ziyarətçi",
          phone: isPhone ? `+${c.handle!.replace(/[^\d]/g, "")}` : null,
          email: isEmail ? c.handle!.toLowerCase() : null,
          source: c.channel.type === "WEBCHAT" ? "website" : c.channel.type.toLowerCase(),
          ownerId: ctx.membershipId,
        });
        await this.activity.record(tx, { type: "contact_created", contactId: created.id, payload: { contactName: created.name } });
        contactId = created.id;
      }
      await tx.conversation.update({ id }, { $set: { contactId } });
      return { contactId };
    });
  }

  async templates(): Promise<CannedResponseDto[]> {
    const { tenantId } = authedContext();
    const rows = await this.db.scoped((tx) => tx.cannedResponse.find({ tenantId }, { sort: { shortcut: 1 } }));
    return rows.map((r) => ({ id: r.id, shortcut: r.shortcut, body: r.body }));
  }

  async createTemplate(input: CannedResponseInput): Promise<CannedResponseDto> {
    const ctx = authedContext();
    const r = await this.db.scoped((tx) => tx.cannedResponse.insertOne({ tenantId: ctx.tenantId, shortcut: input.shortcut, body: input.body, ownerId: ctx.membershipId }));
    return { id: r.id, shortcut: r.shortcut, body: r.body };
  }

  async deleteTemplate(id: string) {
    const { tenantId } = authedContext();
    await this.db.scoped(async (tx) => {
      const res = await tx.cannedResponse.deleteMany({ id, tenantId });
      if (!res.count) throw notFound("Template");
    });
  }

  async metrics(period: keyof typeof PERIOD_DAYS): Promise<InboxMetricsDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { timezone: 1 } });
      const start = addDays(startOfDay(new Date(), tenant.timezone), -(PERIOD_DAYS[period] - 1), tenant.timezone);
      return computeInboxMetrics(tx, ctx, start);
    });
  }

  /** Email channel: the reply leaves from the channel's address, threaded under the customer's email. */
  private async queueEmailReply(tx: Tx, c: ConversationRow, body: string, messageId: string) {
    const tenant = await tx.tenant.get({ id: c.tenantId }, { projection: { name: 1 } });
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
    const c = await tx.conversation.findOne(and({ id, tenantId: ctx.tenantId }, scoped));
    if (!c) throw notFound("Conversation");
    return (await withRelations(tx, ctx.tenantId, [c]))[0]!;
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
  const base = and({ tenantId: ctx.tenantId }, scoped);
  const [[awaitingAgg], answered, byChannelId, channelRows] = await Promise.all([
    tx.conversation.aggregate<{ count: number; oldest: Date | null }>([
      { $match: and(base, { awaitingSince: { $ne: null }, status: { $ne: "RESOLVED" } }) },
      { $group: { _id: null, count: { $sum: 1 }, oldest: { $min: "$awaitingSince" } } },
    ]),
    tx.conversation.find(and(base, { firstResponseMs: { $ne: null }, createdAt: { $gte: start } }), { projection: { assigneeId: 1, firstResponseMs: 1 } }),
    tx.conversation.find(and(base, { createdAt: { $gte: start } }), { projection: { channelId: 1 } }),
    tx.channel.find({ tenantId: ctx.tenantId }, { projection: { id: 1, type: 1 } }),
  ]);
  const channelType = new Map(channelRows.map((ch) => [ch.id, ch.type]));
  const byChannel = byChannelId.map((c) => ({ channel: { type: channelType.get(c.channelId)! } }));
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 60_000) : null);
  const groups = new Map<string, number[]>();
  for (const r of answered) if (r.assigneeId) groups.set(r.assigneeId, [...(groups.get(r.assigneeId) ?? []), r.firstResponseMs!]);
  const refs = await memberRefs(tx, ctx.tenantId, [...groups.keys()]);
  const channels = new Map<string, number>();
  for (const r of byChannel) channels.set(r.channel.type, (channels.get(r.channel.type) ?? 0) + 1);
  return {
    awaiting: awaitingAgg?.count ?? 0,
    longestWaitMin: awaitingAgg?.oldest ? Math.round((Date.now() - awaitingAgg.oldest.getTime()) / 60_000) : null,
    avgFirstResponseMin: avg(answered.map((r) => r.firstResponseMs!)),
    byMember: [...groups].map(([id, xs]) => ({ member: { id, name: refs.get(id)?.name ?? "" }, conversations: xs.length, avgFirstResponseMin: avg(xs) })),
    byChannel: [...channels].map(([type, conversations]) => ({ type: type as InboxMetricsDto["byChannel"][number]["type"], conversations })),
  };
}
