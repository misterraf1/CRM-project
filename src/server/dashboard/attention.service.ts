import type { AttentionItemDto, AttentionReason } from "@/shared";
import { authedContext } from "../common/context";
import { stageIds } from "../crm/deals.service";
import { memberRefs, ownerScope } from "../crm/scope";
import type { Database, Tx } from "../db/database";
import { and } from "../db/query";
import { inboxScope } from "../inbox/inbox.service";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Thresholds: a customer waiting 2 h, a sent quote 2 days without a next step, a deal 7 days untouched */
const UNANSWERED_H = 2;
const QUOTE_FOLLOWUP_D = 2;
const STALE_DEAL_D = 7;
const EXPIRING_D = 2;
const PER_RULE = 25;
const ORDER: AttentionReason[] = ["unanswered", "approval_pending", "invoice_overdue", "order_late", "quote_expiring", "quote_no_followup", "deal_stale"];

const OPEN_TASK = { status: { $nin: ["DONE", "CANCELED"] } };

/**
 * Work that is about to be forgotten, each item with its reason, within what the
 * caller may see. Rules, not guesses: every item says exactly why it is listed.
 */
export class AttentionService {
  constructor(private readonly db: Database) {}

  async list(): Promise<AttentionItemDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const now = Date.now();
      const [owners, convScope, openStages] = await Promise.all([ownerScope(tx, ctx, "contacts.view_all"), inboxScope(tx, ctx), stageIds(tx, ctx.tenantId, "open")]);
      const base = { tenantId: ctx.tenantId };
      const finance = ctx.permissions.includes("finance.view");
      const quotes = ctx.permissions.includes("quotes.manage") || finance;

      const [waiting, sentQuotes, staleDeals, overdue, lateOrders, pending] = await Promise.all([
        tx.conversation.find(and(base, convScope, { status: { $ne: "RESOLVED" }, awaitingSince: { $lt: new Date(now - UNANSWERED_H * HOUR), $ne: null } }), {
          sort: { awaitingSince: 1 },
          limit: PER_RULE,
          projection: { id: 1, displayName: 1, handle: 1, contactId: 1, awaitingSince: 1, assigneeId: 1, status: 1 },
        }),
        quotes
          ? tx.salesDoc.find(and(base, finance ? {} : owners.where, { kind: "quote", status: "sent" }), {
              sort: { sentAt: 1 },
              limit: 200,
              projection: { id: 1, number: 1, contactId: 1, dealId: 1, ownerId: 1, sentAt: 1, dueDate: 1, total: 1, currency: 1 },
            })
          : [],
        tx.deal.find(and(base, owners.where, { stageId: { $in: openStages }, updatedAt: { $lt: new Date(now - STALE_DEAL_D * DAY) } }), {
          sort: { updatedAt: 1 },
          limit: 200,
          projection: { id: 1, title: 1, contactId: 1, ownerId: 1, updatedAt: 1, amount: 1, currency: 1 },
        }),
        finance || ctx.permissions.includes("invoices.manage")
          ? tx.salesDoc.find(and(base, finance ? {} : owners.where, { kind: "invoice", status: "issued", dueDate: { $lt: new Date(now) } }), {
              sort: { dueDate: 1 },
              limit: PER_RULE,
              projection: { id: 1, number: 1, contactId: 1, ownerId: 1, dueDate: 1, total: 1, paidAmount: 1, currency: 1 },
            })
          : [],
        // An order is late when its date passed or one of its open steps is past due
        ctx.permissions.includes("orders.manage")
          ? tx.order.find(
              and(base, owners.where, {
                status: { $in: ["new", "in_progress"] },
                $or: [{ dueDate: { $lt: new Date(now) } }, { steps: { $elemMatch: { doneAt: null, dueDate: { $lt: new Date(now) } } } }],
              }),
              { sort: { dueDate: 1 }, limit: PER_RULE },
            )
          : [],
        // Quotes over the discount limit waiting for this approver
        ctx.permissions.includes("discounts.approve")
          ? tx.salesDoc.find({ ...base, kind: "quote", "approval.status": "pending" }, { sort: { updatedAt: 1 }, limit: PER_RULE, projection: { id: 1, number: 1, contactId: 1, ownerId: 1, total: 1, currency: 1, approval: 1 } })
          : [],
      ]);

      // "Nothing planned": an open task on the record or its customer counts as a next step
      const contactIds = [...sentQuotes.map((q) => q.contactId), ...staleDeals.map((d) => d.contactId)].filter((x): x is string => !!x);
      const dealIds = [...sentQuotes.map((q) => q.dealId), ...staleDeals.map((d) => d.id)].filter((x): x is string => !!x);
      const planned = await this.planned(tx, ctx.tenantId, contactIds, dealIds);
      const hasPlan = (contactId: string | null, dealId: string | null) => (!!contactId && planned.contacts.has(contactId)) || (!!dealId && planned.deals.has(dealId));

      const names = new Map(
        (
          await tx.contact.find(
            { tenantId: ctx.tenantId, id: { $in: [...new Set([...contactIds, ...waiting.map((c) => c.contactId), ...overdue.map((i) => i.contactId), ...lateOrders.map((o) => o.contactId), ...pending.map((q) => q.contactId)].filter((x): x is string => !!x))] } },
            { projection: { id: 1, name: 1 } },
          )
        ).map((c) => [c.id, c.name]),
      );
      const items: (Omit<AttentionItemDto, "owner"> & { ownerId: string | null })[] = [];

      for (const c of waiting) {
        items.push({
          reason: "unanswered",
          title: (c.contactId && names.get(c.contactId)) || c.displayName || c.handle || "—",
          href: `/inbox?status=${c.status}&assignee=all&c=${c.id}`,
          age: Math.floor((now - c.awaitingSince!.getTime()) / HOUR),
          amount: null,
          ownerId: c.assigneeId,
          since: c.awaitingSince!.toISOString(),
        });
      }
      for (const i of overdue) {
        items.push({
          reason: "invoice_overdue",
          title: `${i.number ?? ""} · ${names.get(i.contactId) ?? ""}`,
          href: `/sales/${i.id}`,
          // The due date ends at the close of its day: Oct 27 due, Oct 30 today = 3 days late
          age: Math.max(1, Math.ceil((now - i.dueDate!.getTime()) / DAY)),
          amount: { value: i.total - i.paidAmount, currency: i.currency },
          ownerId: i.ownerId,
          since: i.dueDate!.toISOString(),
        });
      }
      for (const o of lateOrders) {
        const lateSteps = o.steps.filter((s) => !s.doneAt && s.dueDate && s.dueDate.getTime() < now).map((s) => s.dueDate!.getTime());
        const since = Math.min(...lateSteps, o.dueDate && o.dueDate.getTime() < now ? o.dueDate.getTime() : Infinity);
        items.push({
          reason: "order_late",
          title: `${o.number} · ${names.get(o.contactId) ?? o.title}`,
          href: `/orders/${o.id}`,
          age: Math.max(1, Math.ceil((now - since) / DAY)),
          amount: o.total ? { value: o.total, currency: o.currency } : null,
          ownerId: o.ownerId,
          since: new Date(since).toISOString(),
        });
      }
      for (const q of pending) {
        items.push({
          reason: "approval_pending",
          title: `${q.number ?? ""} · ${names.get(q.contactId) ?? ""}`,
          href: `/sales/${q.id}`,
          age: Math.floor((now - q.approval!.at.getTime()) / HOUR),
          amount: { value: q.total, currency: q.currency },
          ownerId: q.ownerId,
          since: q.approval!.at.toISOString(),
        });
      }
      for (const q of sentQuotes) {
        const title = `${q.number ?? ""} · ${names.get(q.contactId) ?? ""}`;
        const amount = { value: q.total, currency: q.currency };
        const expiresIn = q.dueDate ? (q.dueDate.getTime() - now) / DAY : null;
        if (expiresIn !== null && expiresIn >= 0 && expiresIn <= EXPIRING_D) {
          items.push({ reason: "quote_expiring", title, href: `/sales/${q.id}`, age: Math.ceil(expiresIn), amount, ownerId: q.ownerId, since: q.dueDate!.toISOString() });
        } else if (q.sentAt && now - q.sentAt.getTime() > QUOTE_FOLLOWUP_D * DAY && !hasPlan(q.contactId, q.dealId) && (expiresIn === null || expiresIn > 0)) {
          items.push({ reason: "quote_no_followup", title, href: `/sales/${q.id}`, age: Math.floor((now - q.sentAt.getTime()) / DAY), amount, ownerId: q.ownerId, since: q.sentAt.toISOString() });
        }
      }
      for (const d of staleDeals) {
        if (hasPlan(d.contactId, d.id)) continue;
        items.push({
          reason: "deal_stale",
          title: d.title,
          href: `/deals/${d.id}`,
          age: Math.floor((now - d.updatedAt.getTime()) / DAY),
          amount: { value: d.amount, currency: d.currency },
          ownerId: d.ownerId,
          since: d.updatedAt.toISOString(),
        });
      }

      const refs = await memberRefs(tx, ctx.tenantId, items.map((i) => i.ownerId));
      return items
        .sort((a, b) => ORDER.indexOf(a.reason) - ORDER.indexOf(b.reason) || b.age - a.age)
        .slice(0, 60)
        .map(({ ownerId, ...i }) => {
          const r = ownerId ? refs.get(ownerId) : undefined;
          return { ...i, owner: r ? { id: r.id, name: r.name } : null };
        });
    });
  }

  private async planned(tx: Tx, tenantId: string, contactIds: string[], dealIds: string[]) {
    if (!contactIds.length && !dealIds.length) return { contacts: new Set<string>(), deals: new Set<string>() };
    const tasks = await tx.task.find(
      { tenantId, ...OPEN_TASK, $or: [{ contactId: { $in: contactIds } }, { dealId: { $in: dealIds } }] },
      { projection: { contactId: 1, dealId: 1 } },
    );
    return {
      contacts: new Set(tasks.map((t) => t.contactId).filter((x): x is string => !!x)),
      deals: new Set(tasks.map((t) => t.dealId).filter((x): x is string => !!x)),
    };
  }
}
