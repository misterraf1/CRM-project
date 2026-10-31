import { DEFAULT_INBOX_SETTINGS, type MessageAttachmentDto } from "@/shared";
import { AutomationRunner } from "../automations/automation.runner";
import { limitsOf, storageUsed, subscriptionOf } from "../billing/entitlements.service";
import { newId } from "../common/ids";
import type { Channel, Message } from "../db/models";
import type { FileStorage } from "../storage/storage.service";
import type { OutgoingFile } from "./telegram.client";
import { isOpen } from "./hours";

/** At most one automatic out-of-hours reply per conversation in this window */
const AUTO_REPLY_EVERY_MS = 12 * 3600_000;
import type { Tx } from "../db/database";
import { endsWith } from "../db/query";
import { InboxEvents } from "./events";

export interface InboundMessage {
  /** Provider sender id (wa_id, PSID, IGSID) or sha256(visitor token) for website chat */
  externalThread: string;
  /** Provider message id — makes webhook retries idempotent */
  externalMessageId?: string;
  body: string;
  displayName?: string | null;
  handle?: string | null;
  at?: Date;
  /** Email: thread subject and the Message-ID a reply should reference */
  subject?: string | null;
  emailMessageId?: string | null;
  /** Files the customer sent, already downloaded from the provider (or why they couldn't be) */
  files?: (OutgoingFile | { failed: true; name: string; mimeType: string; sizeBytes: number })[];
}

/** Customers' words for "stop writing to me" / "you may write again" (az, en, ru, tr). */
const OPT_OUT = new Set(["stop", "dayandir", "dayandır", "stopp", "стоп", "отписаться", "unsubscribe", "durdur"]);
const OPT_IN = new Set(["start", "başla", "basla", "старт"]);

/**
 * The single path every customer message takes into the inbox (webhooks, website
 * chat, demo simulator), so threading, contact matching, unread counters and
 * response-time tracking behave the same for every channel.
 */
export class IngestService {
  constructor(
    private readonly events: InboxEvents,
    private readonly automations: AutomationRunner,
    private readonly storage: Pick<FileStorage, "put">,
  ) {}

  /** Sends a stored automatic reply once the transaction has committed (wired to the inbox's delivery). */
  onAutoReply?: (tenantId: string, messageId: string) => void;

  /** Returns null when the message was already stored (provider retry). */
  async inbound(tx: Tx, channel: Channel, msg: InboundMessage) {
    const at = msg.at ?? new Date();
    let conversation = await tx.conversation.findOne({ channelId: channel.id, externalThread: msg.externalThread });
    if (!conversation) {
      conversation = await tx.conversation.insertOne({
        tenantId: channel.tenantId,
        channelId: channel.id,
        externalThread: msg.externalThread,
        displayName: msg.displayName ?? null,
        handle: msg.handle ?? null,
        contactId: await this.matchContact(tx, channel.tenantId, msg.handle),
      });
      await this.automations.enqueue(tx, channel.tenantId, "conversation.created", { conversationId: conversation.id });
    }
    if (msg.externalMessageId) {
      const dup = await tx.message.findOne({ conversationId: conversation.id, externalId: msg.externalMessageId });
      if (dup) return null;
    }

    const attachments = msg.files?.length ? await this.storeFiles(tx, channel, conversation.id, msg.files) : [];
    const message = await tx.message.insertOne({
      tenantId: channel.tenantId,
      conversationId: conversation.id,
      direction: "INBOUND",
      body: msg.body,
      attachments: attachments as unknown as Message["attachments"],
      externalId: msg.externalMessageId ?? null,
      createdAt: at,
    });
    // STOP / START: the customer's own say over messages we start
    const word = msg.body.trim().toLowerCase();
    const consent = OPT_OUT.has(word) ? "opted_out" : OPT_IN.has(word) ? "opted_in" : null;
    if (consent) {
      await tx.conversation.update({ id: conversation.id }, { $set: { optedOutAt: consent === "opted_out" ? at : null } });
      if (conversation.contactId) {
        await tx.contact.update({ id: conversation.contactId }, { $set: { messagingConsent: { status: consent, at, source: "keyword" } } });
      }
    } else {
      await this.autoReply(tx, channel, conversation, at);
    }
    await tx.conversation.update(
      { id: conversation.id },
      {
        $inc: { unreadCount: 1 },
        $set: {
        lastMessageAt: at,
        lastInboundAt: at,
        // Waiting since the first unanswered message, not the latest one
        awaitingSince: conversation.awaitingSince ?? at,
        // A new wait: conversation.unanswered may fire again
        ...(conversation.awaitingSince ? {} : { unansweredAlertedAt: null }),
        // A resolved conversation reopens when the customer writes again
        status: "OPEN",
        displayName: conversation.displayName ?? msg.displayName ?? null,
        handle: conversation.handle ?? msg.handle ?? null,
        ...(msg.subject && !conversation.subject ? { subject: msg.subject.slice(0, 300) } : {}),
        ...(msg.emailMessageId ? { emailReplyTo: msg.emailMessageId.slice(0, 500) } : {}),
        },
      },
    );
    // A customer writing counts as activity (passive lists, scoring)
    if (conversation.contactId) await tx.contact.updateMany({ id: conversation.contactId }, { $set: { lastActivityAt: at, inactiveAlertedAt: null, scoredAt: null } });
    this.events.publish(channel.tenantId, { type: "message", conversationId: conversation.id, direction: "INBOUND" });
    return { conversationId: conversation.id, messageId: message.id };
  }

  /**
   * Outside business hours the customer hears back at once (the company's away message).
   * It doesn't count as an answer: the conversation keeps waiting for a person.
   */
  private async autoReply(tx: Tx, channel: Channel, conversation: { id: string; lastAutoReplyAt: Date | null }, at: Date) {
    const tenant = await tx.tenant.get({ id: channel.tenantId }, { projection: { timezone: 1, inboxSettings: 1 } });
    const s = tenant.inboxSettings ?? DEFAULT_INBOX_SETTINGS;
    if (!s.autoReply || !s.awayMessage || isOpen(s, tenant.timezone, at)) return;
    if (conversation.lastAutoReplyAt && at.getTime() - conversation.lastAutoReplyAt.getTime() < AUTO_REPLY_EVERY_MS) return;
    const deliveryStatus = channel.demo ? "demo" : channel.type === "WEBCHAT" ? "sent" : "pending";
    const reply = await tx.message.insertOne({
      tenantId: channel.tenantId,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      authorId: null,
      body: s.awayMessage,
      deliveryStatus,
      createdAt: new Date(at.getTime() + 1),
    });
    await tx.conversation.update({ id: conversation.id }, { $set: { lastAutoReplyAt: at } });
    if (deliveryStatus === "pending") this.onAutoReply?.(channel.tenantId, reply.id);
  }

  /**
   * Stores received files as the conversation's files. Over the storage quota a file is
   * listed without content rather than dropping the customer's message.
   */
  private async storeFiles(tx: Tx, channel: Channel, conversationId: string, files: NonNullable<InboundMessage["files"]>): Promise<MessageAttachmentDto[]> {
    const [sub, used] = await Promise.all([subscriptionOf(tx, channel.tenantId), storageUsed(tx, channel.tenantId)]);
    let free = limitsOf(sub).storageMb * 1024 * 1024 - used;
    const out: MessageAttachmentDto[] = [];
    for (const f of files) {
      if ("failed" in f || f.buffer.length > free) {
        out.push({ fileId: null, name: f.name, mimeType: f.mimeType, sizeBytes: "failed" in f ? f.sizeBytes : f.buffer.length });
        continue;
      }
      const id = newId("fil");
      const key = `tenants/${channel.tenantId}/${id}`;
      await this.storage.put(key, f.buffer);
      await tx.fileObject.insertOne({
        id,
        tenantId: channel.tenantId,
        uploaderId: `channel:${channel.id}`,
        key,
        name: f.name.slice(0, 200),
        mimeType: f.mimeType.slice(0, 100),
        sizeBytes: f.buffer.length,
        entityType: "conversation",
        entityId: conversationId,
      });
      free -= f.buffer.length;
      out.push({ fileId: id, name: f.name, mimeType: f.mimeType, sizeBytes: f.buffer.length });
    }
    return out;
  }

  /** Links the conversation to an existing CRM contact with the same phone or email. */
  private async matchContact(tx: Tx, tenantId: string, handle?: string | null) {
    if (!handle) return null;
    const phone = handle.replace(/[^\d]/g, "");
    const match = await tx.contact.findOne(
      { tenantId, deletedAt: null, $or: [...(phone.length >= 7 ? [{ phone: endsWith(phone.slice(-9)) }] : []), { email: handle.toLowerCase() }] },
      { projection: { id: 1 } },
    );
    return match?.id ?? null;
  }
}
