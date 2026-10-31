import { RENEWAL_LEAD_DAYS, type CustomerValueDto, type RenewalDto, type RenewalStatus } from "@/shared";
import { authedContext, type AuthedContext } from "../common/context";
import { notFound } from "../common/errors";
import { memberRefs, ownerScope } from "../crm/scope";
import type { Database, Tx } from "../db/database";
import type { Renewal } from "../db/models";
import { and } from "../db/query";
import type { Filter } from "../db/repo";
import { NotificationsService } from "../notifications/notifications.service";

const DAY_MS = 86_400_000;

/**
 * Recurring services (hosting, licences, maintenance): a paid invoice line of a product
 * with `renewalMonths` opens the next period; the owner gets a task before it is due.
 */
export class RenewalsService {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  /** Called when an invoice becomes fully paid (inside that transaction). */
  async fromPaidInvoice(tx: Tx, tenantId: string, docId: string) {
    const doc = await tx.salesDoc.findOne({ id: docId, tenantId });
    if (!doc || doc.kind !== "invoice") return;
    const ids = [...new Set(doc.lines.map((l) => l.productId).filter((x): x is string => !!x))];
    if (!ids.length) return;
    const products = await tx.product.find({ tenantId, id: { $in: ids }, renewalMonths: { $ne: null } });
    if (!products.length) return;
    const contact = await tx.contact.findOne({ id: doc.contactId, tenantId }, { projection: { ownerId: 1 } });
    const paidAt = new Date();
    for (const p of products) {
      if (await tx.renewal.count({ tenantId, docId, productId: p.id })) continue;
      // This payment renews whatever period of the same service was still open
      await tx.renewal.updateMany({ tenantId, contactId: doc.contactId, productId: p.id, status: "upcoming" }, { $set: { status: "renewed" } });
      const dueAt = new Date(paidAt);
      dueAt.setUTCMonth(dueAt.getUTCMonth() + p.renewalMonths!);
      const amount = doc.lines.filter((l) => l.productId === p.id).reduce((a, l) => a + l.total, 0);
      await tx.renewal.insertOne({ tenantId, contactId: doc.contactId, productId: p.id, productName: p.name, docId, amount, currency: doc.currency, dueAt, ownerId: doc.ownerId ?? contact?.ownerId ?? null });
    }
  }

  async list(q: { status?: string }): Promise<RenewalDto[]> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const rows = await tx.renewal.find(and({ tenantId: ctx.tenantId }, await this.scope(tx, ctx), q.status ? { status: q.status } : { status: "upcoming" }), { sort: { dueAt: 1 }, limit: 500 });
      return this.dtos(tx, ctx.tenantId, rows);
    });
  }

  async setStatus(id: string, status: RenewalStatus): Promise<RenewalDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const row = await tx.renewal.findOne(and({ id, tenantId: ctx.tenantId }, await this.scope(tx, ctx)));
      if (!row) throw notFound("Renewal");
      const updated = await tx.renewal.update({ id }, { $set: { status } });
      return (await this.dtos(tx, ctx.tenantId, [updated]))[0]!;
    });
  }

  /** Contact card: paid total, last purchase and the coming renewals. */
  async customerValue(contactId: string): Promise<CustomerValueDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const { where } = await ownerScope(tx, ctx, "contacts.view_all");
      if (!(await tx.contact.count(and({ id: contactId, tenantId: ctx.tenantId, deletedAt: null }, where)))) throw notFound("Contact");
      const [tenant, paid, renewals] = await Promise.all([
        tx.tenant.get({ id: ctx.tenantId }, { projection: { currency: 1 } }),
        tx.salesDoc.find({ tenantId: ctx.tenantId, contactId, kind: "invoice", status: "paid" }, { projection: { baseTotal: 1, updatedAt: 1 }, sort: { updatedAt: -1 }, limit: 1000 }),
        tx.renewal.find({ tenantId: ctx.tenantId, contactId, status: "upcoming" }, { sort: { dueAt: 1 }, limit: 20 }),
      ]);
      return {
        currency: tenant.currency,
        totalPaid: paid.reduce((a, d) => a + (d.baseTotal ?? 0), 0),
        invoices: paid.length,
        lastPurchaseAt: paid[0]?.updatedAt.toISOString() ?? null,
        upcomingRenewals: await this.dtos(tx, ctx.tenantId, renewals),
      };
    });
  }

  /** Renewals entering the lead window get a task for their owner (5-minute job). */
  async planTasks(now = new Date()): Promise<number> {
    const due = await this.db.system.renewal.find({ status: "upcoming", taskId: null, dueAt: { $lt: new Date(now.getTime() + RENEWAL_LEAD_DAYS * DAY_MS) } }, { limit: 200 });
    let made = 0;
    for (const r of due) {
      made += await this.db.scoped(
        async (tx) => {
          const contact = await tx.contact.findOne({ id: r.contactId }, { projection: { name: 1, ownerId: 1 } });
          // Nobody responsible: the company owner takes it
          const ownerId =
            r.ownerId ?? contact?.ownerId ?? (await tx.membership.findOne({ tenantId: r.tenantId, role: "OWNER", status: "ACTIVE" }, { projection: { id: 1 } }))?.id ?? null;
          if (!ownerId) return 0;
          const task = await tx.task.insertOne({
            tenantId: r.tenantId,
            title: `↻ ${r.productName} — ${contact?.name ?? ""}`.slice(0, 200),
            priority: "HIGH",
            creatorId: ownerId,
            assigneeId: ownerId,
            dueAt: r.dueAt,
            contactId: r.contactId,
          });
          const claimed = await tx.renewal.updateMany({ id: r.id, taskId: null }, { $set: { taskId: task.id } });
          // Another run got there first: drop this task with the transaction
          if (!claimed.count) throw new Error("renewal already planned");
          await this.notifications.notify(tx, r.tenantId, [ownerId], "renewal_due", { taskId: task.id, title: `${r.productName} — ${contact?.name ?? ""}`, contactId: r.contactId });
          return 1;
        },
        { tenantId: r.tenantId },
      ).catch((e: Error) => (e.message === "renewal already planned" ? 0 : Promise.reject(e)));
    }
    return made;
  }

  private async scope(tx: Tx, ctx: AuthedContext): Promise<Filter> {
    const s = await ownerScope(tx, ctx, "contacts.view_all");
    return s.memberIds ? { ownerId: { $in: s.memberIds } } : {};
  }

  private async dtos(tx: Tx, tenantId: string, rows: Renewal[]): Promise<RenewalDto[]> {
    if (!rows.length) return [];
    const [refs, contacts] = await Promise.all([
      memberRefs(tx, tenantId, rows.map((r) => r.ownerId)),
      tx.contact.find({ tenantId, id: { $in: [...new Set(rows.map((r) => r.contactId))] } }, { projection: { id: 1, name: 1 } }),
    ]);
    const names = new Map(contacts.map((c) => [c.id, c.name]));
    const now = Date.now();
    return rows.map((r) => {
      const o = r.ownerId ? refs.get(r.ownerId) : undefined;
      return {
        id: r.id,
        contact: { id: r.contactId, name: names.get(r.contactId) ?? "—" },
        productName: r.productName,
        amount: r.amount,
        currency: r.currency,
        dueAt: r.dueAt.toISOString(),
        status: r.status as RenewalStatus,
        owner: o ? { id: o.id, name: o.name } : null,
        overdue: r.status === "upcoming" && r.dueAt.getTime() < now,
        docId: r.docId,
      };
    });
  }
}
