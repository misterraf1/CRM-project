import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ChannelType } from "@axis/shared";
import { sha256 } from "../common/ids";
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

  private async resolve(type: ChannelType, externalId: string) {
    const [row] = await this.prisma.$queryRaw<{ tenantId: string; channelId: string }[]>`
      SELECT * FROM channel_for_webhook(${type}, ${externalId})`;
    if (!row) this.logger.warn(`No live ${type} channel for ${externalId}`);
    return row;
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
