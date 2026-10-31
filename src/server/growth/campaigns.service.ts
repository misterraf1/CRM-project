import { CAMPAIGN_ATTRIBUTION_DAYS, CAMPAIGN_MAX_RECIPIENTS, type CampaignDto, type CampaignInput, type CampaignPreviewDto, type CampaignStatus, type Segment } from "@/shared";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { config } from "../config";
import { userNames } from "../crm/scope";
import type { Database, Tx } from "../db/database";
import type { Campaign } from "../db/models";
import type { Filter } from "../db/repo";
import { MailService } from "../mail/mail.service";

const DAY_MS = 86_400_000;
const BATCH = 200;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Unsubscribe links: `<tenantId>.<contactId>.<signature>` — no lookup table, can't be guessed. */
const sign = (tenantId: string, contactId: string) => createHmac("sha256", config().JWT_SECRET).update(`unsub:${tenantId}:${contactId}`).digest("base64url").slice(0, 22);

export function unsubscribeToken(tenantId: string, contactId: string) {
  return `${tenantId}.${contactId}.${sign(tenantId, contactId)}`;
}

export function parseUnsubscribeToken(token: string) {
  const [tenantId, contactId, sig, ...rest] = token.split(".");
  if (!tenantId || !contactId || !sig || rest.length) return null;
  const expected = Buffer.from(sign(tenantId, contactId));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? { tenantId, contactId } : null;
}

/** Contacts a segment covers (people and companies with any address). */
export function segmentFilter(tenantId: string, s: Segment): Filter {
  return {
    tenantId,
    deletedAt: null,
    ...(s.stage ? { stage: s.stage } : {}),
    ...(s.source ? { source: s.source } : {}),
    ...(s.tag ? { tags: s.tag } : {}),
    ...(s.level ? { scoreLevel: s.level } : {}),
    ...(s.ownerId ? { ownerId: s.ownerId } : {}),
    ...(s.activity ? { lastActivityAt: { [s.activity === "passive" ? "$lt" : "$gte"]: new Date(Date.now() - 30 * DAY_MS) } } : {}),
  };
}

/** Who may receive campaign email: an address and no unsubscribe. */
const reachable: Filter = { email: { $ne: null }, emailOptOutAt: null };

/**
 * Email campaigns to a segment of the base, through the regular mail outbox. Every
 * email carries a one-click unsubscribe link; results count deals the recipients won
 * within 30 days. Without SMTP the emails stay queued as "not sent" — never counted as sent.
 */
export class CampaignsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async preview(segment: Segment): Promise<CampaignPreviewDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const where = segmentFilter(ctx.tenantId, segment);
      const [all, ok] = await Promise.all([tx.contact.count(where), tx.contact.count({ ...where, ...reachable })]);
      return { recipients: Math.min(ok, CAMPAIGN_MAX_RECIPIENTS), excluded: all - ok, mailConfigured: this.mail.configured };
    });
  }

  async list(): Promise<CampaignDto[]> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const rows = await tx.campaign.find({ tenantId: ctx.tenantId }, { sort: { createdAt: -1 }, limit: 200 });
      return Promise.all(rows.map((c) => this.dto(tx, c)));
    });
  }

  async get(id: string): Promise<CampaignDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => this.dto(tx, await this.find(tx, ctx.tenantId, id)));
  }

  async create(input: CampaignInput): Promise<CampaignDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const row = await tx.campaign.insertOne({ ...input, tenantId: ctx.tenantId, createdById: ctx.membershipId });
      await this.audit.log(tx, { action: "campaign.created", entityType: "campaign", entityId: row.id, diff: { name: row.name } });
      return this.dto(tx, row);
    });
  }

  async update(id: string, input: CampaignInput): Promise<CampaignDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const current = await this.find(tx, ctx.tenantId, id);
      if (current.status !== "draft") throw new AppError("CONFLICT", "A sent campaign can't be changed");
      return this.dto(tx, await tx.campaign.update({ id }, { $set: input }));
    });
  }

  async remove(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const current = await this.find(tx, ctx.tenantId, id);
      if (current.status !== "draft") throw new AppError("CONFLICT", "A sent campaign stays for its results");
      await tx.campaign.deleteMany({ id, tenantId: ctx.tenantId });
    });
  }

  /** Queues one email per recipient (once: the campaign is claimed first). */
  async send(id: string): Promise<CampaignDto> {
    const ctx = authedContext();
    const campaign = await this.db.scoped(async (tx) => {
      await this.find(tx, ctx.tenantId, id);
      const claimed = await tx.campaign.updateMany({ id, tenantId: ctx.tenantId, status: "draft" }, { $set: { status: "sent", sentAt: new Date() } });
      if (!claimed.count) throw new AppError("CONFLICT", "This campaign was already sent");
      await this.audit.log(tx, { action: "campaign.sent", entityType: "campaign", entityId: id });
      return tx.campaign.get({ id });
    });
    const tenant = await this.db.system.tenant.get({ id: ctx.tenantId }, { projection: { name: 1, locale: 1 } });
    const recipients = await this.db.read((tx) =>
      tx.contact.find({ ...segmentFilter(ctx.tenantId, campaign.segment as Segment), ...reachable }, { projection: { id: 1, name: 1, email: 1 }, sort: { createdAt: 1 }, limit: CAMPAIGN_MAX_RECIPIENTS }),
    );
    for (let i = 0; i < recipients.length; i += BATCH) {
      await this.db.scoped(async (tx) => {
        for (const r of recipients.slice(i, i + BATCH)) {
          const url = `${config().WEB_ORIGIN}/u/${unsubscribeToken(ctx.tenantId, r.id)}`;
          const fill = (text: string) => text.replaceAll("{name}", r.name);
          const body = fill(campaign.body);
          await this.mail.queue(tx, {
            tenantId: ctx.tenantId,
            to: r.email!,
            locale: tenant.locale,
            campaignId: campaign.id,
            contactId: r.id,
            headers: { "List-Unsubscribe": `<${url}>` },
            raw: {
              subject: fill(campaign.subject),
              text: `${body}\n\n— ${tenant.name}\n${url}`,
              html: `<div>${escapeHtml(body).replaceAll("\n", "<br>")}</div><p style="margin-top:24px;color:#6b7280;font-size:12px">— ${escapeHtml(tenant.name)} · <a href="${escapeHtml(url)}">Unsubscribe / Abunəlikdən çıx</a></p>`,
            },
          });
        }
      });
    }
    return this.db.scoped(async (tx) => this.dto(tx, await tx.campaign.update({ id }, { $set: { recipients: recipients.length } })));
  }

  /** The customer's own link: no more campaign email. */
  async unsubscribe(token: string) {
    const parsed = parseUnsubscribeToken(token);
    if (!parsed) throw notFound("Link");
    await this.db.scoped(
      async (tx) => {
        await tx.contact.updateMany({ id: parsed.contactId, tenantId: parsed.tenantId, emailOptOutAt: null }, { $set: { emailOptOutAt: new Date() } });
      },
      { tenantId: parsed.tenantId },
    );
  }

  private async find(tx: Tx, tenantId: string, id: string) {
    const row = await tx.campaign.findOne({ id, tenantId });
    if (!row) throw notFound("Campaign");
    return row;
  }

  private async dto(tx: Tx, c: Campaign): Promise<CampaignDto> {
    const stats = { recipients: c.recipients, sent: 0, failed: 0, pending: 0, unsubscribed: 0, wonDeals: 0, revenue: 0 };
    if (c.status === "sent" && c.sentAt) {
      const mails = await tx.emailMessage.find({ tenantId: c.tenantId, campaignId: c.id }, { projection: { status: 1, contactId: 1 } });
      for (const m of mails) {
        if (m.status === "sent") stats.sent += 1;
        else if (m.status === "failed") stats.failed += 1;
        else stats.pending += 1;
      }
      const ids = [...new Set(mails.map((m) => m.contactId).filter((x): x is string => !!x))];
      if (ids.length) {
        const won = await tx.pipelineStage.find({ tenantId: c.tenantId, kind: "won" }, { projection: { id: 1 } });
        const until = new Date(c.sentAt.getTime() + CAMPAIGN_ATTRIBUTION_DAYS * DAY_MS);
        const [deals, unsubscribed] = await Promise.all([
          tx.deal.find({ tenantId: c.tenantId, contactId: { $in: ids }, stageId: { $in: won.map((s) => s.id) }, closedAt: { $gte: c.sentAt, $lt: until } }, { projection: { baseAmount: 1, amount: 1 } }),
          tx.contact.count({ tenantId: c.tenantId, id: { $in: ids }, emailOptOutAt: { $gte: c.sentAt } }),
        ]);
        stats.wonDeals = deals.length;
        stats.revenue = deals.reduce((a, d) => a + (d.baseAmount ?? d.amount), 0);
        stats.unsubscribed = unsubscribed;
      }
    }
    const creator = c.createdById ? await tx.membership.findOne({ id: c.createdById }, { projection: { userId: 1 } }) : null;
    const names = creator ? await userNames(tx, [creator.userId]) : new Map<string, string>();
    return {
      id: c.id,
      name: c.name,
      subject: c.subject,
      body: c.body,
      segment: c.segment as Segment,
      status: c.status as CampaignStatus,
      sentAt: c.sentAt?.toISOString() ?? null,
      createdBy: creator ? (names.get(creator.userId) ?? null) : null,
      stats,
    };
  }
}
