import type { CaseStatus, PortalDto, PortalLinkDto } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext, currentContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { randomToken, sha256 } from "../common/ids";
import { config } from "../config";
import { ActivityService } from "../crm/activity.service";
import { ownerScope } from "../crm/scope";
import type { Database, Tx } from "../db/database";
import type { UploadedFile } from "../tasks/files.service";
import { and } from "../db/query";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PublicDocsService } from "../sales/public-docs.service";
import { FilesService } from "../tasks/files.service";
import { CASE_SLA_HOURS } from "@/shared";

/** Portal links: `<tenantId>.<secret>`; only sha256(secret) is stored. */
function parsePortalToken(token: string) {
  const dot = token.indexOf(".");
  if (dot < 1 || token.length > 200) throw notFound("Portal");
  return { tenantId: token.slice(0, dot), hash: sha256(token.slice(dot + 1)) };
}

/** Uploader id of files the customer adds from the portal */
export const CUSTOMER_UPLOADER = "customer";

/**
 * The customer's own page (no account: the secret link is the key, and a new link
 * replaces the old one): their quotes and invoices, order progress, service requests,
 * and documents they send us.
 */
export class PortalService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly publicDocs: PublicDocsService,
    private readonly files: FilesService,
  ) {}

  /** Staff: a fresh link for a contact; with `email`, it is also sent to the customer. */
  async createLink(contactId: string, email: boolean): Promise<PortalLinkDto & { emailed: boolean }> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const { where } = await ownerScope(tx, ctx, "contacts.view_all");
      const contact = await tx.contact.findOne(and({ id: contactId, tenantId: ctx.tenantId, deletedAt: null }, where));
      if (!contact) throw notFound("Contact");
      if (email && !contact.email) throw new AppError("VALIDATION_FAILED", "The customer has no email", { email: ["Missing"] });
      const secret = randomToken(24);
      await tx.portalAccess.updateMany({ tenantId: ctx.tenantId, contactId, revokedAt: null }, { $set: { revokedAt: new Date() } });
      await tx.portalAccess.insertOne({ tenantId: ctx.tenantId, contactId, tokenHash: sha256(secret), createdById: ctx.membershipId });
      const path = `/c/${ctx.tenantId}.${secret}`;
      if (email) {
        const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { name: 1, locale: 1 } });
        const link = `${config().WEB_ORIGIN}${path}`;
        await this.mail.queue(tx, {
          tenantId: ctx.tenantId,
          to: contact.email!,
          locale: tenant.locale,
          raw: {
            subject: `${tenant.name}`,
            text: `${contact.name},\n\n${link}\n\n— ${tenant.name}`,
            html: `<p>${contact.name.replace(/[<>&]/g, "")},</p><p><a href="${link}">${link}</a></p><p>— ${tenant.name.replace(/[<>&]/g, "")}</p>`,
          },
        });
      }
      await this.audit.log(tx, { action: "portal.link_created", entityType: "contact", entityId: contactId, diff: { emailed: email } });
      return { path, emailed: email };
    });
  }

  async revoke(contactId: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      await tx.portalAccess.updateMany({ tenantId: ctx.tenantId, contactId, revokedAt: null }, { $set: { revokedAt: new Date() } });
      await this.audit.log(tx, { action: "portal.revoked", entityType: "contact", entityId: contactId });
    });
  }

  private async access(token: string) {
    const { tenantId, hash } = parsePortalToken(token);
    // Notices and timeline entries below belong to this company
    Object.assign(currentContext(), { tenantId });
    const row = await this.db.scoped((tx) => tx.portalAccess.findOne({ tenantId, tokenHash: hash, revokedAt: null }), { tenantId });
    if (!row) throw notFound("Portal");
    return row;
  }

  async view(token: string): Promise<PortalDto> {
    const a = await this.access(token);
    return this.db.scoped(
      async (tx) => {
        const contact = await tx.contact.findOne({ id: a.contactId, tenantId: a.tenantId, deletedAt: null });
        if (!contact) throw notFound("Portal");
        await tx.portalAccess.update({ id: a.id }, { $set: { lastUsedAt: new Date() } });
        const [tenant, docs, orders, cases, files] = await Promise.all([
          tx.tenant.get({ id: a.tenantId }),
          tx.salesDoc.find({ tenantId: a.tenantId, contactId: contact.id, status: { $nin: ["draft", "void"] } }, { sort: { createdAt: -1 }, limit: 100 }),
          tx.order.find({ tenantId: a.tenantId, contactId: contact.id, status: { $ne: "canceled" } }, { sort: { createdAt: -1 }, limit: 50 }),
          tx.serviceCase.find({ tenantId: a.tenantId, contactId: contact.id }, { sort: { createdAt: -1 }, limit: 50 }),
          tx.fileObject.find({ tenantId: a.tenantId, entityType: "contact", entityId: contact.id, uploaderId: CUSTOMER_UPLOADER }, { sort: { createdAt: -1 }, limit: 50 }),
        ]);
        return {
          company: { name: tenant.name, logo: tenant.docSettings?.logo ?? null },
          customer: { name: contact.name },
          docs: docs.map((d) => ({
            id: d.id,
            kind: d.kind,
            number: d.number,
            status: d.status,
            total: d.total,
            paidAmount: d.paidAmount,
            currency: d.currency,
            date: (d.issueDate ?? d.createdAt).toISOString(),
            dueDate: d.dueDate?.toISOString() ?? null,
          })),
          orders: orders.map((o) => ({
            id: o.id,
            number: o.number,
            title: o.title,
            status: o.status,
            progress: { done: o.steps.filter((s) => s.doneAt).length, total: o.steps.length },
            deliveryDate: o.deliveryDate?.toISOString() ?? null,
          })),
          cases: cases.map((c) => ({ id: c.id, number: c.number, subject: c.subject, status: c.status as CaseStatus, createdAt: c.createdAt.toISOString() })),
          files: files.map((f) => ({ id: f.id, name: f.name, createdAt: f.createdAt.toISOString() })),
        };
      },
      { tenantId: a.tenantId },
    );
  }

  async doc(token: string, docId: string) {
    const a = await this.access(token);
    return this.publicDocs.viewOwn(a.tenantId, a.contactId, docId);
  }

  async respond(token: string, docId: string, input: { decision: "accept" | "reject"; name: string; comment?: string | null }) {
    const a = await this.access(token);
    return this.publicDocs.respondOwn(a.tenantId, a.contactId, docId, input);
  }

  /** The customer opens a service request; the contact's owner handles it. */
  async openCase(token: string, input: { subject: string; description?: string | null }) {
    const a = await this.access(token);
    await this.db.scoped(
      async (tx) => {
        const contact = await tx.contact.get({ id: a.contactId });
        const year = new Date().getUTCFullYear();
        const counterId = `doc:${a.tenantId}:case:${year}`;
        const counter = await tx.counter.upsert({ id: counterId }, { $inc: { value: 1 } }, { id: counterId, value: 1 });
        const row = await tx.serviceCase.insertOne({
          tenantId: a.tenantId,
          number: `M-${year}-${String(counter.value).padStart(4, "0")}`,
          contactId: contact.id,
          type: "question",
          subject: input.subject,
          description: input.description ?? null,
          priority: "MEDIUM",
          status: "open",
          assigneeId: contact.ownerId,
          dueAt: new Date(Date.now() + CASE_SLA_HOURS.MEDIUM * 3_600_000),
        });
        await this.activity.record(tx, { tenantId: a.tenantId, type: "case_opened", contactId: contact.id, payload: { caseId: row.id, number: row.number, title: row.subject, byCustomer: true } });
        await this.notifications.notify(tx, a.tenantId, [contact.ownerId], "case_assigned", { caseId: row.id, title: `${row.number} · ${row.subject}` });
      },
      { tenantId: a.tenantId },
    );
    return this.view(token);
  }

  /** A document from the customer lands in the contact's files. */
  async upload(token: string, file: UploadedFile | undefined) {
    const a = await this.access(token);
    await this.files.store({ entityType: "contact", entityId: a.contactId }, file, { tenantId: a.tenantId, membershipId: CUSTOMER_UPLOADER });
    await this.db.scoped(async (tx: Tx) => {
      const contact = await tx.contact.get({ id: a.contactId });
      await this.notifications.notify(tx, a.tenantId, [contact.ownerId], "portal_upload", { contactId: contact.id, title: `${contact.name}: ${file?.originalname ?? ""}` });
    }, { tenantId: a.tenantId });
    return this.view(token);
  }
}
