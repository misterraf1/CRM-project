import { Injectable } from "@nestjs/common";
import type { Channel } from "@prisma/client";
import type { ChannelCreateInput, ChannelDto, SimulateInboundInput } from "@axis/shared";
import { config } from "../config";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { randomToken, sha256 } from "../common/ids";
import { PrismaService } from "../prisma/prisma.service";
import { IngestService } from "./ingest.service";
import { sealCredentials } from "./secrets";

export function widgetKey(c: Pick<Channel, "tenantId" | "id">) {
  return `${c.tenantId}.${c.id}`;
}

export function toChannelDto(c: Channel): ChannelDto {
  const settings = (c.settings ?? {}) as { greeting?: string };
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
    createdAt: c.createdAt.toISOString(),
  };
}

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
  ) {}

  async list(): Promise<ChannelDto[]> {
    const { tenantId } = authedContext();
    const rows = await this.prisma.scoped((tx) =>
      tx.channel.findMany({ where: { tenantId, status: { not: "disconnected" } }, orderBy: { createdAt: "asc" } }),
    );
    return rows.map(toChannelDto);
  }

  async create(input: ChannelCreateInput): Promise<ChannelDto> {
    const { tenantId } = authedContext();
    let externalId: string;
    let credentials: Buffer | null = null;
    let demo = false;

    if (input.type === "WEBCHAT") {
      externalId = `web_${randomToken(9)}`;
    } else {
      demo = input.demo;
      const providerId = input.type === "WHATSAPP" ? input.phoneNumberId : input.accountId;
      if (demo) {
        externalId = `demo_${randomToken(9)}`;
      } else {
        if (!providerId || !input.accessToken) {
          throw new AppError("VALIDATION_FAILED", "Provider id and access token are required", {
            [input.type === "WHATSAPP" ? "phoneNumberId" : "accountId"]: providerId ? [] : ["Required"],
            accessToken: input.accessToken ? [] : ["Required"],
          });
        }
        externalId = providerId;
        credentials = sealCredentials({ accessToken: input.accessToken });
      }
    }

    const channel = await this.prisma.scoped((tx) =>
      tx.channel.create({
        data: {
          tenantId,
          type: input.type,
          name: input.name,
          externalId,
          credentials,
          demo,
          settings: input.type === "WEBCHAT" && input.greeting ? { greeting: input.greeting } : {},
        },
      }),
    );
    return toChannelDto(channel);
  }

  /** Disconnects: credentials are wiped, history stays. */
  async disconnect(id: string) {
    const { tenantId } = authedContext();
    await this.prisma.scoped(async (tx) => {
      const c = await tx.channel.findFirst({ where: { id, tenantId } });
      if (!c) throw notFound("Channel");
      await tx.channel.update({ where: { id }, data: { status: "disconnected", credentials: null } });
    });
  }

  /** Demo channels only: injects a customer message as if it arrived from the provider. */
  async simulate(id: string, input: SimulateInboundInput) {
    const { tenantId } = authedContext();
    return this.prisma.scoped(async (tx) => {
      const channel = await tx.channel.findFirst({ where: { id, tenantId, status: { not: "disconnected" } } });
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
