import type { Channel } from "../db/models";
import type { ChannelCreateInput, ChannelDto, SimulateInboundInput, WhatsAppTemplateDto } from "@/shared";
import { config } from "../config";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { randomToken, sha256 } from "../common/ids";
import type { Database } from "../db/database";
import { IngestService } from "./ingest.service";
import { openCredentials, sealCredentials } from "../common/secrets";
import { MailService } from "../mail/mail.service";
import { MetaClient } from "./meta.client";
import { TelegramClient } from "./telegram.client";

/** Shown on demo WhatsApp channels so the template flow can be tried without Meta. */
const DEMO_TEMPLATES: WhatsAppTemplateDto[] = [
  { name: "order_ready", language: "az", body: "Salam {{1}}! {{2}} nömrəli sifarişiniz hazırdır.", params: 2 },
  { name: "follow_up", language: "az", body: "Salam {{1}}, təklifimizə baxa bildinizmi?", params: 1 },
];

interface ChannelSettings {
  greeting?: string;
  address?: string;
  wabaId?: string;
  botUsername?: string;
  templates?: WhatsAppTemplateDto[];
}

export const channelSettings = (c: Pick<Channel, "settings">) => (c.settings ?? {}) as ChannelSettings;

export function widgetKey(c: Pick<Channel, "tenantId" | "id">) {
  return `${c.tenantId}.${c.id}`;
}

export function toChannelDto(c: Channel): ChannelDto {
  const settings = channelSettings(c);
  const origin = config().WEB_ORIGIN;
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    demo: c.demo,
    status: c.status as ChannelDto["status"],
    externalId: c.externalId,
    embedCode:
      c.type === "WEBCHAT" ? `<script src="${origin}/widget.js" data-axis-widget="${widgetKey(c)}" async></script>` : null,
    greeting: settings.greeting ?? null,
    ...(c.type === "TELEGRAM" ? { botUsername: settings.botUsername ?? null } : {}),
    ...(c.type === "WHATSAPP" ? { templates: settings.templates?.length ?? 0, canSyncTemplates: !c.demo && !!settings.wabaId } : {}),
    createdAt: c.createdAt.toISOString(),
  };
}

export class ChannelsService {
  constructor(
    private readonly db: Database,
    private readonly ingest: IngestService,
    private readonly mail: MailService,
    private readonly meta: MetaClient,
    private readonly telegram: TelegramClient,
  ) {}

  async list(): Promise<ChannelDto[]> {
    const { tenantId } = authedContext();
    const rows = await this.db.scoped((tx) => tx.channel.find({ tenantId, status: { $ne: "disconnected" } }, { sort: { createdAt: 1 } }));
    return rows.map(toChannelDto);
  }

  async create(input: ChannelCreateInput): Promise<ChannelDto> {
    const { tenantId } = authedContext();
    let externalId: string;
    let credentials: Buffer | null = null;
    let demo = false;
    let inboundToken: string | null = null;
    let settings: ChannelSettings = {};
    let telegramSecret: string | null = null;
    let botToken: string | null = null;

    if (input.type === "WEBCHAT") {
      externalId = `web_${randomToken(9)}`;
    } else if (input.type === "EMAIL") {
      if (!authedContext().features?.includes("inbox.omnichannel")) {
        throw new AppError("FEATURE_NOT_IN_PLAN", "Messaging channels need the PRO plan or higher", { feature: "inbox.omnichannel" });
      }
      demo = input.demo;
      // Demo channels never route real mail, so the address needn't be unique across companies
      externalId = demo ? `demo_${randomToken(9)}` : input.address;
      if (!demo) {
        // A real email channel must be able to answer: no SMTP, no channel
        if (!this.mail.configured) throw new AppError("CHANNEL_ERROR", "Outgoing email (SMTP_URL) must be configured before an email channel can be connected", { reason: "smtp" });
        inboundToken = randomToken(24);
        credentials = sealCredentials({ inboundToken });
      }
    } else if (input.type === "TELEGRAM") {
      if (!authedContext().features?.includes("inbox.omnichannel")) {
        throw new AppError("FEATURE_NOT_IN_PLAN", "Messaging channels need the PRO plan or higher", { feature: "inbox.omnichannel" });
      }
      demo = input.demo;
      if (demo) externalId = `demo_${randomToken(9)}`;
      else {
        if (!input.botToken) throw new AppError("VALIDATION_FAILED", "The bot token is required", { botToken: ["Required"] });
        // The token is checked with Telegram before anything is stored
        const bot = await this.telegram.getMe(input.botToken);
        externalId = String(bot.id);
        settings = { botUsername: bot.username ?? bot.first_name };
        botToken = input.botToken;
        telegramSecret = randomToken(24);
        credentials = sealCredentials({ accessToken: botToken, webhookSecret: telegramSecret });
      }
    } else {
      // WhatsApp / Instagram / Messenger (demo channels included): PRO and up
      if (!authedContext().features?.includes("inbox.omnichannel")) {
        throw new AppError("FEATURE_NOT_IN_PLAN", "Messaging channels need the PRO plan or higher", { feature: "inbox.omnichannel" });
      }
      demo = input.demo;
      const meta = input as Extract<ChannelCreateInput, { type: "WHATSAPP" | "INSTAGRAM" | "MESSENGER" }>;
      const providerId = meta.type === "WHATSAPP" ? meta.phoneNumberId : meta.accountId;
      if (demo) {
        externalId = `demo_${randomToken(9)}`;
      } else {
        if (!providerId || !meta.accessToken) {
          throw new AppError("VALIDATION_FAILED", "Provider id and access token are required", {
            [input.type === "WHATSAPP" ? "phoneNumberId" : "accountId"]: providerId ? [] : ["Required"],
            accessToken: meta.accessToken ? [] : ["Required"],
          });
        }
        externalId = providerId;
        credentials = sealCredentials({ accessToken: meta.accessToken });
      }
    }

    const channel = await this.db.scoped((tx) =>
      tx.channel.insertOne({
        tenantId,
        type: input.type,
        name: input.name,
        externalId,
        credentials,
        demo,
        settings: (input.type === "WEBCHAT" && input.greeting
          ? { greeting: input.greeting }
          : input.type === "EMAIL"
            ? { address: input.address }
            : input.type === "WHATSAPP"
              ? { ...(input.wabaId ? { wabaId: input.wabaId } : {}), ...(demo ? { templates: DEMO_TEMPLATES } : {}) }
              : settings) as Channel["settings"],
      }),
    );
    if (botToken && telegramSecret) {
      // Telegram delivers to our webhook with the secret in a header; without it the channel can't receive
      try {
        await this.telegram.setWebhook(botToken, `${config().PUBLIC_API_URL ?? config().WEB_ORIGIN}/v1/webhooks/telegram/${channel.id}`, telegramSecret);
      } catch (e) {
        await this.db.scoped((tx) => tx.channel.delete({ id: channel.id }));
        throw e;
      }
    }
    // The inbound address carries its secret: shown once, when the channel is created
    return inboundToken ? { ...toChannelDto(channel), inboundUrl: `${config().PUBLIC_API_URL ?? config().WEB_ORIGIN}/v1/webhooks/email/${channel.id}?token=${inboundToken}` } : toChannelDto(channel);
  }

  /** Disconnects: credentials are wiped, history stays. */
  async disconnect(id: string) {
    const { tenantId } = authedContext();
    await this.db.scoped(async (tx) => {
      const c = await tx.channel.findOne({ id, tenantId });
      if (!c) throw notFound("Channel");
      // Telegram stops delivering to us (best effort: the bot may already be deleted)
      if (c.type === "TELEGRAM" && !c.demo && c.credentials) {
        await this.telegram.deleteWebhook(openCredentials(c.credentials).accessToken!).catch(() => undefined);
      }
      // The provider id is unique among channels: renaming it lets the same number / page / bot
      // be connected again later (the original id stays readable after the prefix)
      await tx.channel.update({ id }, { $set: { status: "disconnected", credentials: null, externalId: `disconnected:${id}:${c.externalId}` } });
    });
  }

  /** Reloads the approved templates of a WhatsApp channel from Meta. */
  async syncTemplates(id: string): Promise<ChannelDto> {
    const { tenantId } = authedContext();
    const channel = await this.db.scoped((tx) => tx.channel.findOne({ id, tenantId, type: "WHATSAPP", status: { $ne: "disconnected" } }));
    if (!channel) throw notFound("Channel");
    const s = channelSettings(channel);
    if (channel.demo || !s.wabaId || !channel.credentials) throw new AppError("CONFLICT", "Templates need a real WhatsApp channel with its Business Account id");
    const templates = await this.meta.listTemplates(s.wabaId, openCredentials(channel.credentials).accessToken!);
    const updated = await this.db.scoped((tx) => tx.channel.update({ id }, { $set: { settings: { ...s, templates } as Channel["settings"] } }));
    return toChannelDto(updated);
  }

  /** Demo channels only: injects a customer message as if it arrived from the provider. */
  async simulate(id: string, input: SimulateInboundInput) {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const channel = await tx.channel.findOne({ id, tenantId, status: { $ne: "disconnected" } });
      if (!channel) throw notFound("Channel");
      if (!channel.demo) throw new AppError("FORBIDDEN", "Only demo channels accept simulated messages");
      const result = await this.ingest.inbound(tx, channel, {
        externalThread: `sim_${sha256(input.from).slice(0, 24)}`,
        body: input.body,
        displayName: input.name ?? input.from,
        handle: input.from,
      });
      return { conversationId: result!.conversationId };
    });
  }
}
