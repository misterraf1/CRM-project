import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ChannelType } from "@axis/shared";
import { timingSafeEqual } from "node:crypto";
import { AppError } from "../common/errors";
import { sha256 } from "../common/ids";
import { openCredentials } from "../common/secrets";
import { PrismaService } from "../prisma/prisma.service";
import { IngestService } from "./ingest.service";

interface WaValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: { from: string; id: string; timestamp?: string; type?: string; text?: { body?: string } }[];
  statuses?: { id: string; status: string }[];
}

interface PageEvent {
  sender?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] };
}

interface MetaPayload {
  object?: string;
  entry?: { id?: string; changes?: { value?: WaValue }[]; messaging?: PageEvent[] }[];
}

/** Inbound email as posted by the provider (Postmark's inbound webhook format). */
export interface InboundEmail {
  From?: string;
  FromName?: string;
  FromFull?: { Email?: string; Name?: string };
  Subject?: string;
  TextBody?: string;
  /** The new text without the quoted history, when the provider can tell */
  StrippedTextReply?: string;
  MessageID?: string;
  Headers?: { Name: string; Value: string }[];
}

/** Parses Meta webhook payloads (WhatsApp Cloud API, Messenger, Instagram) into inbox messages. */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger("Webhooks");

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
  ) {}

  async processMeta(raw: Buffer, payload: MetaPayload) {
    // Whole-delivery idempotency: Meta retries identical bodies
    try {
      await this.prisma.webhookEvent.create({ data: { provider: "meta", externalId: sha256(raw.toString("utf8")), payload: payload as Prisma.InputJsonObject } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { duplicate: true, stored: 0 };
      throw e;
    }

    let stored = 0;
    for (const entry of payload.entry ?? []) {
      if (payload.object === "whatsapp_business_account") {
        for (const change of entry.changes ?? []) stored += await this.whatsapp(change.value ?? {});
      } else if (payload.object === "page" || payload.object === "instagram") {
        stored += await this.page(payload.object === "page" ? "MESSENGER" : "INSTAGRAM", entry.id ?? "", entry.messaging ?? []);
      }
    }
    return { duplicate: false, stored };
  }

  /**
   * Email channel deliveries: the URL carries the channel id and its secret token
   * (shown once when the channel was connected).
   */
  async processEmail(channelId: string, token: string, mail: InboundEmail) {
    const channel = await this.prisma.system(() =>
      this.prisma.channel.findFirst({ where: { id: channelId, type: "EMAIL", demo: false, status: { not: "disconnected" } } }),
    );
    const expected = channel?.credentials ? Buffer.from(openCredentials(channel.credentials).inboundToken ?? "") : Buffer.alloc(0);
    const given = Buffer.from(token);
    if (!channel || !expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError("FORBIDDEN", "Invalid inbound address");
    }
    const from = (mail.FromFull?.Email ?? mail.From ?? "").trim().toLowerCase();
    const body = (mail.StrippedTextReply?.trim() || mail.TextBody?.trim() || "").slice(0, 20_000);
    if (!from || !body) return { stored: 0 };
    const messageId = mail.MessageID || mail.Headers?.find((h) => h.Name.toLowerCase() === "message-id")?.Value || null;
    const res = await this.prisma.scoped(
      (tx) =>
        this.ingest.inbound(tx, channel, {
          externalThread: from,
          externalMessageId: messageId ?? undefined,
          body,
          displayName: mail.FromFull?.Name || mail.FromName || null,
          handle: from,
          subject: mail.Subject ?? null,
          emailMessageId: messageId,
        }),
      { tenantId: channel.tenantId },
    );
    return { stored: res ? 1 : 0 };
  }

  private async resolve(type: ChannelType, externalId: string) {
    // Meta only tells us the phone number / page id: resolve the one live channel
    // (and its tenant) across tenants, then continue tenant-scoped
    const channel = await this.prisma.system(() =>
      this.prisma.channel.findFirst({
        where: { type, externalId, demo: false, status: { not: "disconnected" } },
        select: { id: true, tenantId: true },
      }),
    );
    if (!channel) this.logger.warn(`No live ${type} channel for ${externalId}`);
    return channel ? { tenantId: channel.tenantId, channelId: channel.id } : undefined;
  }

  private async whatsapp(value: WaValue) {
    const target = value.metadata?.phone_number_id && (await this.resolve("WHATSAPP", value.metadata.phone_number_id));
    if (!target) return 0;
    const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
    return this.prisma.scoped(
      async (tx) => {
        const channel = await tx.channel.findUniqueOrThrow({ where: { id: target.channelId } });
        let stored = 0;
        for (const m of value.messages ?? []) {
          const res = await this.ingest.inbound(tx, channel, {
            externalThread: m.from,
            externalMessageId: m.id,
            body: m.type === "text" ? (m.text?.body ?? "") : `[${m.type ?? "message"}]`,
            displayName: names.get(m.from) ?? null,
            handle: `+${m.from}`,
            at: m.timestamp ? new Date(Number(m.timestamp) * 1000) : undefined,
          });
          if (res) stored++;
        }
        // Delivery receipts for our outbound messages
        for (const s of value.statuses ?? []) {
          await tx.message.updateMany({ where: { tenantId: target.tenantId, externalId: s.id, direction: "OUTBOUND" }, data: { deliveryStatus: s.status } });
        }
        return stored;
      },
      { tenantId: target.tenantId },
    );
  }

  private async page(type: "MESSENGER" | "INSTAGRAM", accountId: string, events: PageEvent[]) {
    const target = await this.resolve(type, accountId);
    if (!target) return 0;
    return this.prisma.scoped(
      async (tx) => {
        const channel = await tx.channel.findUniqueOrThrow({ where: { id: target.channelId } });
        let stored = 0;
        for (const e of events) {
          // Echoes are our own outbound messages reflected back
          if (!e.message || e.message.is_echo || !e.sender?.id) continue;
          const res = await this.ingest.inbound(tx, channel, {
            externalThread: e.sender.id,
            externalMessageId: e.message.mid,
            body: e.message.text ?? "[attachment]",
            at: e.timestamp ? new Date(e.timestamp) : undefined,
          });
          if (res) stored++;
        }
        return stored;
      },
      { tenantId: target.tenantId },
    );
  }
}
