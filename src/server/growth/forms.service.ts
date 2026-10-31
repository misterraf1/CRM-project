import type { PublicFormDto, WebFormDto, WebFormInput, formSubmitSchema } from "@/shared";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { AutomationRunner } from "../automations/automation.runner";
import { EntitlementsService } from "../billing/entitlements.service";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { ActivityService } from "../crm/activity.service";
import type { Database, Tx } from "../db/database";
import type { WebForm } from "../db/models";
import { NotificationsService } from "../notifications/notifications.service";

const MAX_FORMS = 50;

/** Public key `<tenantId>.<formId>`: embedded in the customer's website. */
export function parseFormKey(key: string) {
  const [tenantId, formId, ...rest] = key.split(".");
  if (!tenantId || !formId || rest.length) throw notFound("Form");
  return { tenantId, formId };
}

const toDto = (f: WebForm): WebFormDto => ({
  id: f.id,
  key: `${f.tenantId}.${f.id}`,
  name: f.name,
  title: f.title,
  fields: f.fields as WebFormDto["fields"],
  successMessage: f.successMessage,
  assigneeIds: f.assigneeIds,
  createDeal: f.createDeal,
  active: f.active,
  submissions: f.submissions,
  lastSubmissionAt: f.lastSubmissionAt?.toISOString() ?? null,
});

const digits = (phone: string) => phone.replace(/[^\d+]/g, "");

/**
 * Website forms (lead capture): a hosted page / iframe posts here, the visitor becomes
 * a contact (or is matched to an existing one by email or phone), gets an owner in
 * turn, optionally a deal, and the usual automations run.
 */
export class FormsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly automations: AutomationRunner,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(): Promise<WebFormDto[]> {
    const ctx = authedContext();
    return (await this.db.read((tx) => tx.webForm.find({ tenantId: ctx.tenantId }, { sort: { createdAt: -1 }, limit: MAX_FORMS }))).map(toDto);
  }

  async create(input: WebFormInput): Promise<WebFormDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      if ((await tx.webForm.count({ tenantId: ctx.tenantId })) >= MAX_FORMS) throw new AppError("CONFLICT", `At most ${MAX_FORMS} forms`);
      await this.checkMembers(tx, ctx.tenantId, input.assigneeIds);
      const form = await tx.webForm.insertOne({ ...input, tenantId: ctx.tenantId, createdById: ctx.membershipId });
      await this.audit.log(tx, { action: "form.created", entityType: "form", entityId: form.id, diff: { name: form.name } });
      return toDto(form);
    });
  }

  async update(id: string, input: WebFormInput): Promise<WebFormDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      if (!(await tx.webForm.count({ id, tenantId: ctx.tenantId }))) throw notFound("Form");
      await this.checkMembers(tx, ctx.tenantId, input.assigneeIds);
      const form = await tx.webForm.update({ id }, { $set: input });
      await this.audit.log(tx, { action: "form.updated", entityType: "form", entityId: id });
      return toDto(form);
    });
  }

  async remove(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const res = await tx.webForm.deleteMany({ id, tenantId: ctx.tenantId });
      if (!res.count) throw notFound("Form");
      await this.audit.log(tx, { action: "form.deleted", entityType: "form", entityId: id });
    });
  }

  /** What the hosted page shows (inactive forms are gone for visitors). */
  async publicForm(key: string): Promise<PublicFormDto> {
    const { tenantId, formId } = parseFormKey(key);
    return this.db.scoped(
      async (tx) => {
        const form = await tx.webForm.findOne({ id: formId, tenantId, active: true });
        if (!form) throw notFound("Form");
        const tenant = await tx.tenant.get({ id: tenantId }, { projection: { name: 1 } });
        return { companyName: tenant.name, title: form.title, fields: form.fields as PublicFormDto["fields"], successMessage: form.successMessage };
      },
      { tenantId },
    );
  }

  async submit(key: string, input: z.infer<typeof formSubmitSchema>): Promise<{ message: string }> {
    const { tenantId, formId } = parseFormKey(key);
    return this.db.scoped(
      async (tx) => {
        const form = await tx.webForm.findOne({ id: formId, tenantId, active: true });
        if (!form) throw notFound("Form");
        // Bots fill the hidden field: answer as if it worked, store nothing
        if (input.website) return { message: form.successMessage };

        const fields = form.fields as WebFormDto["fields"];
        const values: Record<string, string> = {};
        const missing: Record<string, string[]> = {};
        for (const f of fields) {
          const v = (input.values[f.key as keyof typeof input.values] ?? "").trim();
          if (f.required && !v) missing[f.key] = ["Required"];
          if (v) values[f.key] = v;
        }
        if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) missing.email = ["Invalid email"];
        if (!values.email && !values.phone) missing[fields.some((f) => f.key === "email") ? "email" : "phone"] = ["Email or phone required"];
        if (Object.keys(missing).length) throw new AppError("VALIDATION_FAILED", "Check the form", missing);

        const email = values.email?.toLowerCase() ?? null;
        const phone = values.phone ? digits(values.phone) : null;
        const name = values.name || email || phone || "—";
        const existing = await tx.contact.findOne({ tenantId, deletedAt: null, $or: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] });
        let contactId: string;
        let ownerId: string | null;
        if (existing) {
          contactId = existing.id;
          ownerId = existing.ownerId;
        } else {
          await this.entitlements.assertCapacity(tx, tenantId, "contacts");
          ownerId = await this.nextOwner(tx, form);
          const contact = await tx.contact.insertOne({
            tenantId,
            type: "person",
            name: name.slice(0, 200),
            email,
            phone,
            companyName: values.company?.slice(0, 200) ?? null,
            stage: "LEAD",
            source: "website",
            tags: [],
            customFields: {},
            ownerId,
          });
          contactId = contact.id;
          await this.activity.record(tx, { tenantId, type: "contact_created", contactId, payload: { contactName: contact.name } });
          await this.automations.enqueue(tx, tenantId, "contact.created", { contactId });
        }
        await this.activity.record(tx, { tenantId, type: "form_submitted", contactId, payload: { title: form.name, values, page: input.page ?? null } });

        // A returning customer with an open deal keeps that one
        if (form.createDeal && !(existing && (await tx.deal.count({ tenantId, contactId, closedAt: null })))) {
          const pipeline = (await tx.pipeline.findOne({ tenantId, isDefault: true })) ?? (await tx.pipeline.findOne({ tenantId }));
          const stage = pipeline && (await tx.pipelineStage.findOne({ tenantId, pipelineId: pipeline.id, kind: "open" }, { sort: { order: 1 } }));
          if (pipeline && stage) {
            const tenant = await tx.tenant.get({ id: tenantId }, { projection: { currency: 1 } });
            const last = await tx.deal.findOne({ stageId: stage.id }, { sort: { position: -1 }, projection: { position: 1 } });
            const deal = await tx.deal.insertOne({
              tenantId,
              pipelineId: pipeline.id,
              stageId: stage.id,
              title: `${form.name}: ${name}`.slice(0, 200),
              amount: 0,
              currency: tenant.currency,
              baseAmount: 0,
              customFields: {},
              contactId,
              ownerId,
              expectedClose: null,
              position: (last?.position ?? 0) + 1024,
            });
            await this.activity.record(tx, { tenantId, type: "deal_created", contactId, dealId: deal.id, payload: { dealTitle: deal.title, amount: 0 } });
            await this.automations.enqueue(tx, tenantId, "deal.created", { dealId: deal.id });
          }
        }
        await tx.webForm.update({ id: form.id }, { $inc: { submissions: 1 }, $set: { lastSubmissionAt: new Date() } });
        await this.notifications.notify(tx, tenantId, [ownerId], "form_submission", { contactId, title: `${form.name}: ${name}` });
        return { message: form.successMessage };
      },
      { tenantId },
    );
  }

  /** Next member in turn among the form's assignees (skipping inactive ones), else the company owner. */
  private async nextOwner(tx: Tx, form: WebForm) {
    const active = form.assigneeIds.length
      ? (await tx.membership.find({ tenantId: form.tenantId, id: { $in: form.assigneeIds }, status: "ACTIVE" }, { projection: { id: 1 } })).map((m) => m.id)
      : [];
    const pool = form.assigneeIds.filter((id) => active.includes(id));
    if (pool.length) {
      const { rrCursor } = await tx.webForm.update({ id: form.id }, { $inc: { rrCursor: 1 } });
      return pool[(rrCursor - 1) % pool.length]!;
    }
    return (await tx.membership.findOne({ tenantId: form.tenantId, role: "OWNER", status: "ACTIVE" }, { projection: { id: 1 } }))?.id ?? null;
  }

  private async checkMembers(tx: Tx, tenantId: string, ids: string[]) {
    if (!ids.length) return;
    const found = await tx.membership.count({ tenantId, id: { $in: ids }, status: "ACTIVE" });
    if (found !== new Set(ids).size) throw new AppError("VALIDATION_FAILED", "Unknown member", { assigneeIds: ["Unknown member"] });
  }
}
