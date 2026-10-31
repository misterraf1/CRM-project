import { DEFAULT_INBOX_SETTINGS, leadScore, type AutomationConditions } from "@/shared";
import type { Database } from "../db/database";
import { AutomationRunner } from "./automation.runner";

const DAY_MS = 86_400_000;
const BATCH = 200;
/** Contacts rescored per run (dirty ones first; everyone at least daily for the time-based reasons) */
const SCORE_BATCH = 500;

/**
 * Time-based signals the request flow can't see: a customer gone quiet, a customer
 * waiting past the reply target, and the lead score. Runs on the 5-minute tick.
 * Each event fires once per quiet spell / wait: activity clears the marker.
 */
export class Signals {
  constructor(
    private readonly db: Database,
    private readonly automations: AutomationRunner,
  ) {}

  async run(now = new Date()) {
    return (await this.inactiveContacts(now)) + (await this.unansweredConversations(now)) + (await this.score(now));
  }

  /** Tenants with an enabled rule for a trigger, and the rules' conditions. */
  private async rulesByTenant(trigger: string) {
    const rules = await this.db.system.automationRule.find({ trigger, enabled: true }, { projection: { tenantId: 1, conditions: 1 } });
    const map = new Map<string, AutomationConditions[]>();
    for (const r of rules) map.set(r.tenantId, [...(map.get(r.tenantId) ?? []), r.conditions as AutomationConditions]);
    return map;
  }

  private async inactiveContacts(now: Date) {
    let fired = 0;
    for (const [tenantId, conditions] of await this.rulesByTenant("contact.inactive")) {
      // The shortest quiet spell any rule asks for; each rule checks its own when it runs
      const days = Math.min(...conditions.map((c) => c.inactiveDays ?? 30));
      const quiet = await this.db.system.contact.find(
        { tenantId, deletedAt: null, inactiveAlertedAt: null, lastActivityAt: { $lt: new Date(now.getTime() - days * DAY_MS) } },
        { projection: { id: 1 }, limit: BATCH },
      );
      for (const { id } of quiet) {
        fired += await this.db.scoped(
          async (tx) => {
            const claimed = await tx.contact.updateMany({ id, inactiveAlertedAt: null }, { $set: { inactiveAlertedAt: now } });
            if (!claimed.count) return 0;
            await this.automations.enqueue(tx, tenantId, "contact.inactive", { contactId: id });
            return 1;
          },
          { tenantId },
        );
      }
    }
    return fired;
  }

  private async unansweredConversations(now: Date) {
    let fired = 0;
    for (const tenantId of (await this.rulesByTenant("conversation.unanswered")).keys()) {
      const tenant = await this.db.system.tenant.findOne({ id: tenantId }, { projection: { inboxSettings: 1 } });
      const slaMs = (tenant?.inboxSettings ?? DEFAULT_INBOX_SETTINGS).slaMinutes * 60_000;
      const waiting = await this.db.system.conversation.find(
        { tenantId, status: { $ne: "RESOLVED" }, unansweredAlertedAt: null, awaitingSince: { $ne: null, $lt: new Date(now.getTime() - slaMs) } },
        { projection: { id: 1 }, limit: BATCH },
      );
      for (const { id } of waiting) {
        fired += await this.db.scoped(
          async (tx) => {
            const claimed = await tx.conversation.updateMany({ id, unansweredAlertedAt: null }, { $set: { unansweredAlertedAt: now } });
            if (!claimed.count) return 0;
            await this.automations.enqueue(tx, tenantId, "conversation.unanswered", { conversationId: id });
            return 1;
          },
          { tenantId },
        );
      }
    }
    return fired;
  }

  /** Rule-based lead score: contacts touched since their last scoring, then the stalest. */
  async score(now = new Date()) {
    const contacts = this.db.system.contact;
    const dirty = await contacts.find({ deletedAt: null, scoredAt: null }, { limit: SCORE_BATCH });
    const stale = dirty.length < SCORE_BATCH ? await contacts.find({ deletedAt: null, scoredAt: { $lt: new Date(now.getTime() - DAY_MS) } }, { sort: { scoredAt: 1 }, limit: SCORE_BATCH - dirty.length }) : [];
    const rows = [...dirty, ...stale];
    if (!rows.length) return 0;
    const ids = rows.map((c) => c.id);
    const sys = this.db.system;
    const [deals, docs, convs] = await Promise.all([
      sys.deal.find({ contactId: { $in: ids }, closedAt: null }, { projection: { contactId: 1, baseAmount: 1, amount: 1 } }),
      sys.salesDoc.find({ contactId: { $in: ids }, $or: [{ kind: "quote", status: { $in: ["sent", "accepted"] } }, { kind: "invoice", status: "paid" }] }, { projection: { contactId: 1, kind: 1, status: 1 } }),
      sys.conversation.find({ contactId: { $in: ids }, lastInboundAt: { $gt: new Date(now.getTime() - 7 * DAY_MS) } }, { projection: { contactId: 1 } }),
    ]);
    const wrote = new Set(convs.map((c) => c.contactId));
    for (const c of rows) {
      const own = deals.filter((d) => d.contactId === c.id);
      const mine = docs.filter((d) => d.contactId === c.id);
      const last = c.lastActivityAt ?? c.createdAt;
      const { score, level, reasons } = leadScore({
        hasEmailOrPhone: !!(c.email || c.phone),
        daysSinceActivity: Math.floor((now.getTime() - last.getTime()) / DAY_MS),
        wroteWithin7Days: wrote.has(c.id),
        openDeals: own.length,
        largestOpenDeal: Math.max(0, ...own.map((d) => d.baseAmount ?? d.amount)),
        openQuotes: mine.filter((d) => d.kind === "quote" && d.status === "sent").length,
        acceptedQuotes: mine.filter((d) => d.kind === "quote" && d.status === "accepted").length,
        isCustomer: c.stage === "CUSTOMER",
        paidInvoices: mine.filter((d) => d.kind === "invoice").length,
      });
      // Conditional on the version scored: a change meanwhile keeps the contact dirty
      await contacts.updateMany({ id: c.id, scoredAt: c.scoredAt }, { $set: { score, scoreLevel: level, scoreReasons: reasons, scoredAt: now } });
    }
    return 0;
  }
}
