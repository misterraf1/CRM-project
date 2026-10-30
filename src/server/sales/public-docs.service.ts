import type { DocStatus, PublicDocDto } from "@/shared";
import { currentContext } from "../common/context";
import { notFound } from "../common/errors";
import type { Database, Tx } from "../db/database";
import { derived, parseDocToken, SalesDocsService } from "./docs.service";

/**
 * The customer's page behind a quote/invoice link: no account, only the secret in the
 * link. It shows the document without anything internal (owner, deal, notes of staff).
 */
export class PublicDocsService {
  constructor(
    private readonly db: Database,
    private readonly docs: SalesDocsService,
  ) {}

  async view(token: string): Promise<PublicDocDto> {
    const { tenantId, hash } = parseDocToken(token);
    return this.db.scoped(async (tx) => this.dto(tx, await this.find(tx, tenantId, hash)), { tenantId });
  }

  async respond(token: string, input: { decision: "accept" | "reject"; name: string; comment?: string | null }): Promise<PublicDocDto> {
    const { tenantId, hash } = parseDocToken(token);
    // Timeline entries and notifications below belong to this company
    Object.assign(currentContext(), { tenantId });
    return this.db.scoped(async (tx) => {
      const doc = await this.find(tx, tenantId, hash);
      if (doc.kind !== "quote") throw notFound("Quote");
      const updated = await this.docs.applyResponse(tx, doc, { decision: input.decision, name: input.name, comment: input.comment ?? null }, true);
      return this.dto(tx, updated);
    }, { tenantId });
  }

  private async find(tx: Tx, tenantId: string, hash: string) {
    const doc = await tx.salesDoc.findOne({ tenantId, publicToken: hash });
    if (!doc || doc.status === "void") throw notFound("Document");
    return doc;
  }

  private async dto(tx: Tx, d: Awaited<ReturnType<PublicDocsService["find"]>>): Promise<PublicDocDto> {
    const [tenant, contact] = await Promise.all([tx.tenant.get({ id: d.tenantId }), tx.contact.findOne({ id: d.contactId, tenantId: d.tenantId })]);
    const s = tenant.docSettings ?? {};
    return {
      kind: d.kind,
      number: d.number,
      status: d.status as DocStatus,
      expired: derived(d).expired,
      company: { name: tenant.name, legalName: s.legalName ?? null, taxId: s.taxId ?? null, address: s.address ?? null, bankDetails: s.bankDetails ?? null, terms: s.terms ?? null },
      customer: { name: contact?.name ?? "", email: contact?.email ?? null, phone: contact?.phone ?? null, companyName: contact?.companyName ?? null },
      currency: d.currency,
      lines: d.lines.map((l) => ({ ...l })),
      subtotal: d.subtotal,
      discountTotal: d.discountTotal,
      taxTotal: d.taxTotal,
      total: d.total,
      paidAmount: d.paidAmount,
      issueDate: d.issueDate?.toISOString() ?? null,
      dueDate: d.dueDate?.toISOString() ?? null,
      notes: d.notes,
      response: d.response ? { decision: d.response.decision, name: d.response.name, at: d.response.at.toISOString() } : null,
      locale: tenant.locale.toLowerCase(),
    };
  }
}
