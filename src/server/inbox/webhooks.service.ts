import { Logger } from "../common/logger";
import type { ChannelType } from "@/shared";
import { timingSafeEqual } from "node:crypto";
import { AppError } from "../common/errors";
import { sha256 } from "../common/ids";
import { openCredentials } from "../common/secrets";
import type { Database } from "../db/database";
import { isDuplicateKey } from "../db/errors";
import type { WebhookEvent } from "../db/models";
import { IngestService, type InboundMessage } from "./ingest.service";
import { MetaClient } from "./meta.client";
import { TelegramClient } from "./telegram.client";

/** Files customers send are kept up to this size (larger ones are listed without content). */
export const INBOUND_FILE_MAX = 20 * 1024 * 1024;

type WaMedia = { id: string; mime_type?: string; caption?: string; filename?: string };

interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id: number;
    date?: number;
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
    text?: string;
    caption?: string;
    photo?: { file_id: string; file_size?: number; width?: number }[];
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    voice?: { file_id: string; mime_type?: string; file_size?: number };
    audio?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    video?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  };
}

interface WaValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: {
    from: string;
    id: string;
    timestamp?: string;
    type?: string;
    text?: { body?: string };
    image?: WaMedia;
    document?: WaMedia;
    audio?: WaMedia;
    video?: WaMedia;
    sticker?: WaMedia;
  }[];
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
export class WebhooksService {
  private readonly logger = new Logger("Webhooks");

  constructor(
    private readonly db: Database,
    private readonly ingest: IngestService,
    private readonly meta: MetaClient,
    private readonly telegram: TelegramClient,
  ) {}

  /**
   * Telegram deliveries: the URL names the channel and the header carries the secret we
   * gave Telegram with setWebhook. Only private chats become conversations.
   */
  async processTelegram(channelId: string, secret: string, update: TelegramUpdate) {
    const channel = await this.db.system.channel.findOne({ id: channelId, type: "TELEGRAM", demo: false, status: { $ne: "disconnected" } });
    const creds = channel?.credentials ? openCredentials(channel.credentials) : null;
    const expected = Buffer.from(creds?.webhookSecret ?? "");
    const given = Buffer.from(secret);
    if (!channel || !creds || !expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError("FORBIDDEN", "Invalid webhook secret");
    }
    const m = update.message;
    if (!m || m.chat.type !== "private") return { stored: 0 };
    const token = creds.accessToken!;
    // Largest photo size, or the one attached file
    const photo = m.photo?.length ? m.photo[m.photo.length - 1] : undefined;
    const media = photo
      ? { file_id: photo.file_id, name: `photo_${m.message_id}.jpg`, mime: "image/jpeg", size: photo.file_size ?? 0 }
      : m.document
        ? { file_id: m.document.file_id, name: m.document.file_name ?? "document", mime: m.document.mime_type ?? "application/octet-stream", size: m.document.file_size ?? 0 }
        : m.voice
          ? { file_id: m.voice.file_id, name: `voice_${m.message_id}.ogg`, mime: m.voice.mime_type ?? "audio/ogg", size: m.voice.file_size ?? 0 }
          : (m.audio ?? m.video)
            ? { file_id: (m.audio ?? m.video)!.file_id, name: (m.audio ?? m.video)!.file_name ?? "file", mime: (m.audio ?? m.video)!.mime_type ?? "application/octet-stream", size: (m.audio ?? m.video)!.file_size ?? 0 }
            : null;
    const files: InboundMessage["files"] = [];
    if (media) {
      try {
        files.push({ buffer: await this.telegram.download(token, media.file_id, INBOUND_FILE_MAX), name: media.name, mimeType: media.mime });
      } catch (e) {
        this.logger.warn(`Telegram file not stored: ${e instanceof Error ? e.message : e}`);
        files.push({ failed: true, name: media.name, mimeType: media.mime, sizeBytes: media.size });
      }
    }
    const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || null;
    const res = await this.db.scoped(
      (tx) =>
        this.ingest.inbound(tx, channel, {
          externalThread: String(m.chat.id),
          externalMessageId: `${m.chat.id}:${m.message_id}`,
          body: m.text ?? m.caption ?? "",
          displayName: name,
          handle: m.from?.username ? `@${m.from.username}` : null,
          at: m.date ? new Date(m.date * 1000) : undefined,
          files,
        }),
      { tenantId: channel.tenantId },
    );
    return { stored: res ? 1 : 0 };
  }

  async processMeta(raw: Buffer, payload: MetaPayload) {
    // Whole-delivery idempotency: Meta retries identical bodies
    try {
      await this.db.system.webhookEvent.insertOne({ provider: "meta", externalId: sha256(raw.toString("utf8")), payload: payload as unknown as WebhookEvent["payload"] });
    } catch (e) {
      if (isDuplicateKey(e)) return { duplicate: true, stored: 0 };
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
    const channel = await this.db.system.channel.findOne({ id: channelId, type: "EMAIL", demo: false, status: { $ne: "disconnected" } });
    const expected = channel?.credentials ? Buffer.from(openCredentials(channel.credentials).inboundToken ?? "") : Buffer.alloc(0);
    const given = Buffer.from(token);
    if (!channel || !expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError("FORBIDDEN", "Invalid inbound address");
    }
    const from = (mail.FromFull?.Email ?? mail.From ?? "").trim().toLowerCase();
    const body = (mail.StrippedTextReply?.trim() || mail.TextBody?.trim() || "").slice(0, 20_000);
    if (!from || !body) return { stored: 0 };
    const messageId = mail.MessageID || mail.Headers?.find((h) => h.Name.toLowerCase() === "message-id")?.Value || null;
    const res = await this.db.scoped(
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
    const channel = await this.db.system.channel.findOne({ type, externalId, demo: false, status: { $ne: "disconnected" } }, { projection: { id: 1, tenantId: 1 } });
    if (!channel) this.logger.warn(`No live ${type} channel for ${externalId}`);
    return channel ? { tenantId: channel.tenantId, channelId: channel.id } : undefined;
  }

  private async whatsapp(value: WaValue) {
    const target = value.metadata?.phone_number_id && (await this.resolve("WHATSAPP", value.metadata.phone_number_id));
    if (!target) return 0;
    const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
    // Media is downloaded before the transaction: provider calls don't hold it open
    const channelRow = await this.db.system.channel.get({ id: target.channelId });
    const token = channelRow.credentials ? openCredentials(channelRow.credentials).accessToken : undefined;
    const prepared = await Promise.all(
      (value.messages ?? []).map(async (m) => {
        const media = m.image ?? m.document ?? m.audio ?? m.video ?? m.sticker;
        const files: InboundMessage["files"] = [];
        if (media) {
          const name = media.filename ?? `${m.type ?? "file"}_${m.id.slice(-8)}`;
          const mimeType = media.mime_type ?? "application/octet-stream";
          try {
            if (!token) throw new Error("no token");
            const file = await this.meta.downloadWhatsAppMedia(token, media.id, INBOUND_FILE_MAX);
            files.push({ buffer: file.buffer, name, mimeType: file.mimeType });
          } catch (e) {
            this.logger.warn(`WhatsApp media not stored: ${e instanceof Error ? e.message : e}`);
            files.push({ failed: true, name, mimeType, sizeBytes: 0 });
          }
        }
        const body = m.type === "text" ? (m.text?.body ?? "") : (media?.caption ?? (media ? "" : `[${m.type ?? "message"}]`));
        return { m, files, body };
      }),
    );
    return this.db.scoped(
      async (tx) => {
        const channel = await tx.channel.get({ id: target.channelId });
        let stored = 0;
        for (const { m, files, body } of prepared) {
          const res = await this.ingest.inbound(tx, channel, {
            externalThread: m.from,
            externalMessageId: m.id,
            body,
            displayName: names.get(m.from) ?? null,
            handle: `+${m.from}`,
            at: m.timestamp ? new Date(Number(m.timestamp) * 1000) : undefined,
            files,
          });
          if (res) stored++;
        }
        // Delivery receipts for our outbound messages
        for (const s of value.statuses ?? []) {
          await tx.message.updateMany({ tenantId: target.tenantId, externalId: s.id, direction: "OUTBOUND" }, { $set: { deliveryStatus: s.status } });
        }
        return stored;
      },
      { tenantId: target.tenantId },
    );
  }

  private async page(type: "MESSENGER" | "INSTAGRAM", accountId: string, events: PageEvent[]) {
    const target = await this.resolve(type, accountId);
    if (!target) return 0;
    return this.db.scoped(
      async (tx) => {
        const channel = await tx.channel.get({ id: target.channelId });
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
