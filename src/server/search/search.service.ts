import type { SearchHitDto } from "@/shared";
import { authedContext } from "../common/context";
import { ownerScope } from "../crm/scope";
import type { Database } from "../db/database";
import { and, contains } from "../db/query";
import { inboxScope } from "../inbox/inbox.service";
import { taskScope } from "../tasks/tasks.service";

const PER_KIND = 5;

/**
 * One box for everything (Cmd+K): contacts, deals, tasks, conversations, quotes,
 * invoices and orders — each kind searched within what the caller may see.
 */
export class SearchService {
  constructor(private readonly db: Database) {}

  async search(q: string): Promise<SearchHitDto[]> {
    const ctx = authedContext();
    const p = ctx.permissions;
    const has = (x: string) => p.includes(x as never);
    const deals = ctx.features?.includes("deals.pipeline");
    return this.db.scoped(async (tx) => {
      const [owners, tasks, inbox] = await Promise.all([ownerScope(tx, ctx, "contacts.view_all"), taskScope(tx, ctx), inboxScope(tx, ctx)]);
      const base = { tenantId: ctx.tenantId };
      const text = contains(q);
      const docScope = has("finance.view") ? {} : owners.where;
      const [contacts, dealRows, taskRows, convs, docs, orders] = await Promise.all([
        tx.contact.find(and(base, owners.where, { deletedAt: null, $or: [{ name: text }, { email: text }, { phone: text }, { companyName: text }] }), {
          limit: PER_KIND,
          sort: { updatedAt: -1 },
          projection: { id: 1, name: 1, email: 1, phone: 1, type: 1 },
        }),
        deals ? tx.deal.find(and(base, owners.where, { title: text }), { limit: PER_KIND, sort: { updatedAt: -1 }, projection: { id: 1, title: 1, amount: 1, currency: 1 } }) : [],
        tx.task.find(and(base, tasks.where, { title: text }), { limit: PER_KIND, sort: { updatedAt: -1 }, projection: { id: 1, title: 1, status: 1 } }),
        tx.conversation.find(and(base, inbox, { $or: [{ displayName: text }, { handle: text }] }), { limit: PER_KIND, sort: { lastMessageAt: -1 }, projection: { id: 1, displayName: 1, handle: 1 } }),
        has("quotes.manage") || has("finance.view") || has("invoices.manage")
          ? tx.salesDoc.find(and(base, docScope, { number: text }, has("finance.view") || has("invoices.manage") ? {} : { kind: "quote" }), {
              limit: PER_KIND,
              sort: { createdAt: -1 },
              projection: { id: 1, kind: 1, number: 1, contactId: 1 },
            })
          : [],
        has("orders.manage") ? tx.order.find(and(base, owners.where, { $or: [{ number: text }, { title: text }] }), { limit: PER_KIND, sort: { createdAt: -1 }, projection: { id: 1, number: 1, title: 1 } }) : [],
      ]);
      const docContacts = new Map((await tx.contact.find({ tenantId: ctx.tenantId, id: { $in: docs.map((d) => d.contactId) } }, { projection: { id: 1, name: 1 } })).map((c) => [c.id, c.name]));
      return [
        ...contacts.map((c): SearchHitDto => ({ kind: "contact", id: c.id, title: c.name, subtitle: c.email ?? c.phone ?? null, href: `/crm/${c.id}` })),
        ...dealRows.map((d): SearchHitDto => ({ kind: "deal", id: d.id, title: d.title, subtitle: null, href: `/deals/${d.id}` })),
        ...taskRows.map((t): SearchHitDto => ({ kind: "task", id: t.id, title: t.title, subtitle: null, href: `/tasks/${t.id}` })),
        ...convs.map((c): SearchHitDto => ({ kind: "conversation", id: c.id, title: c.displayName ?? c.handle ?? "—", subtitle: c.handle, href: `/inbox?status=ALL&assignee=all&c=${c.id}` })),
        ...docs.map((d): SearchHitDto => ({ kind: d.kind, id: d.id, title: d.number ?? "—", subtitle: docContacts.get(d.contactId) ?? null, href: `/sales/${d.id}` })),
        ...orders.map((o): SearchHitDto => ({ kind: "order", id: o.id, title: `${o.number} · ${o.title}`, subtitle: null, href: `/orders/${o.id}` })),
      ];
    });
  }
}
