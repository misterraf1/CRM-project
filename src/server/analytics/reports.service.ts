import type { AnalyticsQuery, ProductSalesDto, ReceivablesDto, SavedReportDto } from "@/shared";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { newId } from "../common/ids";
import { addDays, startOfDay } from "../common/time";
import { ownerScope } from "../crm/scope";
import type { Database } from "../db/database";
import { and } from "../db/query";

const DAY_MS = 86_400_000;
const PERIOD_DAYS = { "30d": 30, "90d": 90, "365d": 365 } as const;
const MAX_SAVED = 20;

/** Money reports beside the analytics: who owes what, and what sells. */
export class ReportsService {
  constructor(private readonly db: Database) {}

  /** Issued, not fully paid invoices; finance sees the company, others their own documents. */
  async receivables(): Promise<ReceivablesDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const [tenant, { where }] = await Promise.all([tx.tenant.get({ id: ctx.tenantId }, { projection: { currency: 1 } }), ownerScope(tx, ctx, "finance.view")]);
      const docs = await tx.salesDoc.find(and({ tenantId: ctx.tenantId, kind: "invoice", status: "issued" }, where), { projection: { contactId: 1, total: 1, baseTotal: 1, paidAmount: 1, dueDate: 1 }, limit: 5000 });
      const now = Date.now();
      const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
      const byContact = new Map<string, { invoices: number; due: number; oldest: Date | null }>();
      let total = 0;
      for (const d of docs) {
        // In the company currency, in proportion to what is still open
        const due = d.total ? Math.round(((d.total - d.paidAmount) / d.total) * d.baseTotal) : 0;
        if (due <= 0) continue;
        total += due;
        const late = d.dueDate ? Math.floor((now - d.dueDate.getTime()) / DAY_MS) : 0;
        if (late <= 0) buckets.current += due;
        else if (late <= 30) buckets.d1_30 += due;
        else if (late <= 60) buckets.d31_60 += due;
        else if (late <= 90) buckets.d61_90 += due;
        else buckets.d90 += due;
        const cur = byContact.get(d.contactId) ?? { invoices: 0, due: 0, oldest: null };
        byContact.set(d.contactId, { invoices: cur.invoices + 1, due: cur.due + due, oldest: d.dueDate && (!cur.oldest || d.dueDate < cur.oldest) ? d.dueDate : cur.oldest });
      }
      const names = new Map((await tx.contact.find({ tenantId: ctx.tenantId, id: { $in: [...byContact.keys()] } }, { projection: { id: 1, name: 1 } })).map((c) => [c.id, c.name]));
      const customers = [...byContact.entries()]
        .map(([id, v]) => ({
          contact: { id, name: names.get(id) ?? "—" },
          invoices: v.invoices,
          due: v.due,
          oldestDueDate: v.oldest?.toISOString() ?? null,
          daysLate: v.oldest ? Math.max(0, Math.floor((now - v.oldest.getTime()) / DAY_MS)) : 0,
        }))
        .sort((a, b) => b.daysLate - a.daysLate || b.due - a.due);
      return { currency: tenant.currency, total, buckets, customers };
    });
  }

  /** Lines of invoices issued in the period, by product, in the company currency. */
  async productSales(q: AnalyticsQuery): Promise<ProductSalesDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const [tenant, { where }] = await Promise.all([tx.tenant.get({ id: ctx.tenantId }, { projection: { currency: 1, timezone: 1 } }), ownerScope(tx, ctx, "finance.view")]);
      const now = new Date();
      const custom = q.from && q.to;
      const start = custom ? startOfDay(new Date(`${q.from}T12:00:00Z`), tenant.timezone) : addDays(startOfDay(now, tenant.timezone), -(PERIOD_DAYS[q.period] - 1), tenant.timezone);
      const end = custom ? addDays(startOfDay(new Date(`${q.to}T12:00:00Z`), tenant.timezone), 1, tenant.timezone) : now;
      const docs = await tx.salesDoc.find(and({ tenantId: ctx.tenantId, kind: "invoice", status: { $in: ["issued", "paid"] }, issueDate: { $gte: start, $lt: end } }, where), {
        projection: { lines: 1, total: 1, baseTotal: 1 },
        limit: 5000,
      });
      const rows = new Map<string, ProductSalesDto["rows"][number]>();
      for (const d of docs) {
        const rate = d.total ? d.baseTotal / d.total : 1;
        const seen = new Set<string>();
        for (const l of d.lines) {
          const key = l.productId ?? `name:${l.name.toLowerCase()}`;
          const cur = rows.get(key) ?? { productId: l.productId, name: l.name, quantity: 0, revenue: 0, invoices: 0 };
          cur.quantity += l.quantity;
          cur.revenue += Math.round(l.total * rate);
          if (!seen.has(key)) cur.invoices += 1;
          seen.add(key);
          rows.set(key, cur);
        }
      }
      return { currency: tenant.currency, rows: [...rows.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 100) };
    });
  }

  async saved(): Promise<SavedReportDto[]> {
    const ctx = authedContext();
    const m = await this.db.read((tx) => tx.membership.get({ id: ctx.membershipId }));
    return m.savedReports ?? [];
  }

  async save(input: { name: string; query: string }): Promise<SavedReportDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const m = await tx.membership.get({ id: ctx.membershipId });
      if ((m.savedReports ?? []).length >= MAX_SAVED) throw new AppError("CONFLICT", `At most ${MAX_SAVED} saved reports`);
      const updated = await tx.membership.update({ id: m.id }, { $push: { savedReports: { id: newId("rpt"), ...input } } });
      return updated.savedReports;
    });
  }

  async removeSaved(id: string): Promise<SavedReportDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const m = await tx.membership.get({ id: ctx.membershipId });
      if (!(m.savedReports ?? []).some((r) => r.id === id)) throw notFound("Report");
      return (await tx.membership.update({ id: m.id }, { $pull: { savedReports: { id } } })).savedReports;
    });
  }
}
