import { Injectable } from "@nestjs/common";
import { AutomationRunner } from "../automations/automation.runner";
import type { Channel } from "@prisma/client";
import type { Tx } from "../prisma/prisma.service";
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
}

/**
 * The single path every customer message takes into the inbox (webhooks, website
 * chat, demo simulator), so threading, contact matching, unread counters and
 * response-time tracking behave the same for every channel.
 */
@Injectable()
export class IngestService {
  constructor(
    private readonly events: InboxEvents,
    private readonly automations: AutomationRunner,
  ) {}

  /** Returns null when the message was already stored (provider retry). */
  async inbound(tx: Tx, channel: Channel, msg: InboundMessage) {
    const at = msg.at ?? new Date();
    let conversation = await tx.conversation.findUnique({
      where: { channelId_externalThread: { channelId: channel.id, externalThread: msg.externalThread } },
    });
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: {
          tenantId: channel.tenantId,
          channelId: channel.id,
          externalThread: msg.externalThread,
          displayName: msg.displayName ?? null,
          handle: msg.handle ?? null,
          contactId: await this.matchContact(tx, channel.tenantId, msg.handle),
        },
      });
      await this.automations.enqueue(tx, channel.tenantId, "conversation.created", { conversationId: conversation.id });
    }
    if (msg.externalMessageId) {
      const dup = await tx.message.findUnique({
        where: { conversationId_externalId: { conversationId: conversation.id, externalId: msg.externalMessageId } },
      });
      if (dup) return null;
    }

    const message = await tx.message.create({
      data: {
        tenantId: channel.tenantId,
        conversationId: conversation.id,
        direction: "INBOUND",
        body: msg.body,
        externalId: msg.externalMessageId ?? null,
        createdAt: at,
      },
    });
    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: { increment: 1 },
        lastMessageAt: at,
        lastInboundAt: at,
        // Waiting since the first unanswered message, not the latest one
        awaitingSince: conversation.awaitingSince ?? at,
        // A resolved conversation reopens when the customer writes again
        status: "OPEN",
        displayName: conversation.displayName ?? msg.displayName ?? null,
        handle: conversation.handle ?? msg.handle ?? null,
        ...(msg.subject && !conversation.subject ? { subject: msg.subject.slice(0, 300) } : {}),
        ...(msg.emailMessageId ? { emailReplyTo: msg.emailMessageId.slice(0, 500) } : {}),
      },
    });
    this.events.publish(channel.tenantId, { type: "message", conversationId: conversation.id, direction: "INBOUND" });
    return { conversationId: conversation.id, messageId: message.id };
  }

  /** Links the conversation to an existing CRM contact with the same phone or email. */
  private async matchContact(tx: Tx, tenantId: string, handle?: string | null) {
    if (!handle) return null;
    const phone = handle.replace(/[^\d]/g, "");
    const match = await tx.contact.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        OR: [...(phone.length >= 7 ? [{ phone: { endsWith: phone.slice(-9) } }] : []), { email: handle.toLowerCase() }],
      },
      select: { id: true },
    });
    return match?.id ?? null;
  }
}
