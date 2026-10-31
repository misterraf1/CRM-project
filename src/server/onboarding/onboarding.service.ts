import type { BusinessTemplateKey, OnboardingDto, TemplateResultDto } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext } from "../common/context";
import { AppError } from "../common/errors";
import type { Database, Tx } from "../db/database";
import { BUSINESS_TEMPLATES, CLOSED_STAGES } from "./templates";

const DAY_MS = 86_400_000;
type Lang = "az" | "en" | "ru";
const langOf = (locale: string): Lang => (locale === "EN" ? "en" : locale === "RU" ? "ru" : "az");

/** Sample customers for trying things out (removed in one go, nothing else is touched). */
const DEMO: Record<Lang, { contacts: [string, string, string][]; deals: [string, number][]; tasks: string[] }> = {
  az: {
    contacts: [["Aynur Həsənova", "aynur@numune.az", "+994501110001"], ["Rauf Quliyev", "rauf@numune.az", "+994501110002"], ["Nümunə MMC", "info@numune.az", "+994121110003"]],
    deals: [["Ofis üçün CRM", 240_000], ["Sayt yenilənməsi", 90_000]],
    tasks: ["Aynur xanıma zəng", "Təklifi göndər"],
  },
  en: {
    contacts: [["Anna Smith", "anna@example.com", "+10000000001"], ["John Brown", "john@example.com", "+10000000002"], ["Sample Ltd", "info@example.com", "+10000000003"]],
    deals: [["CRM for the office", 240_000], ["Website refresh", 90_000]],
    tasks: ["Call Anna", "Send the quote"],
  },
  ru: {
    contacts: [["Анна Иванова", "anna@primer.ru", "+70000000001"], ["Иван Петров", "ivan@primer.ru", "+70000000002"], ["ООО Пример", "info@primer.ru", "+70000000003"]],
    deals: [["CRM для офиса", 240_000], ["Обновление сайта", 90_000]],
    tasks: ["Позвонить Анне", "Отправить предложение"],
  },
};

/**
 * Getting a new company going: a checklist computed from what exists, line-of-business
 * templates that only add (never replace), and removable sample data.
 */
export class OnboardingService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async state(): Promise<OnboardingDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const t = ctx.tenantId;
      const [tenant, members, channels, contacts, deals, quotes] = await Promise.all([
        tx.tenant.get({ id: t }),
        tx.membership.count({ tenantId: t }),
        tx.channel.count({ tenantId: t, status: { $ne: "disconnected" } }),
        tx.contact.count({ tenantId: t, deletedAt: null }),
        tx.deal.count({ tenantId: t }),
        tx.salesDoc.count({ tenantId: t }),
      ]);
      const ob = tenant.onboarding ?? { dismissedAt: null, templates: [], demo: null };
      const profile = !!(tenant.docSettings?.logo || tenant.docSettings?.legalName);
      return {
        steps: [
          { key: "profile", done: profile },
          { key: "team", done: members > 1 },
          { key: "channel", done: channels > 0 },
          { key: "contact", done: contacts > (ob.demo?.contactIds.length ?? 0) },
          { key: "deal", done: deals > (ob.demo?.dealIds.length ?? 0) },
          { key: "quote", done: quotes > 0 },
          { key: "template", done: ob.templates.length > 0 },
        ],
        dismissed: !!ob.dismissedAt,
        demo: !!ob.demo,
        appliedTemplates: ob.templates as BusinessTemplateKey[],
      };
    });
  }

  async dismiss(dismissed: boolean) {
    const ctx = authedContext();
    await this.db.scoped((tx) => tx.tenant.update({ id: ctx.tenantId }, { $set: { "onboarding.dismissedAt": dismissed ? new Date() : null } }));
    return this.state();
  }

  /** Adds the template's pipeline, fields, order steps, products and (disabled) rules. */
  async applyTemplate(key: BusinessTemplateKey, makeDefault: boolean): Promise<TemplateResultDto> {
    const ctx = authedContext();
    const tpl = BUSINESS_TEMPLATES[key];
    return this.db.scoped(async (tx) => {
      const tenant = await tx.tenant.get({ id: ctx.tenantId });
      const lang = langOf(tenant.locale);
      if ((await tx.pipeline.count({ tenantId: ctx.tenantId })) >= 20) throw new AppError("CONFLICT", "At most 20 pipelines");
      if (makeDefault) await tx.pipeline.updateMany({ tenantId: ctx.tenantId, isDefault: true }, { $set: { isDefault: false } });
      const pipeline = await tx.pipeline.insertOne({ tenantId: ctx.tenantId, name: tpl.pipeline[lang], isDefault: makeDefault });
      const stages = [...tpl.stages.map((s) => ({ ...s, kind: "open" as const })), ...CLOSED_STAGES];
      await tx.pipelineStage.insertMany(stages.map((s, order) => ({ tenantId: ctx.tenantId, pipelineId: pipeline.id, name: s.name[lang], probability: s.probability, kind: s.kind, order })));

      // Fields: skip labels the company already has for that record type
      let fields = 0;
      for (const f of tpl.fields) {
        const label = f.label[lang];
        if (await tx.fieldDefinition.count({ tenantId: ctx.tenantId, entity: f.entity, label })) continue;
        const order = await tx.fieldDefinition.count({ tenantId: ctx.tenantId, entity: f.entity });
        await tx.fieldDefinition.insertOne({ tenantId: ctx.tenantId, entity: f.entity, label, type: f.type, options: (f.options ?? []).map((o) => o[lang]), order });
        fields += 1;
      }
      // Order steps only where none are set yet
      if (!tenant.docSettings?.orderSteps?.length) await tx.tenant.update({ id: ctx.tenantId }, { $set: { "docSettings.orderSteps": tpl.orderSteps.map((s) => s[lang]) } });

      let products = 0;
      for (const p of tpl.products) {
        const name = p.name[lang];
        if (await tx.product.count({ tenantId: ctx.tenantId, name })) continue;
        await tx.product.insertOne({ tenantId: ctx.tenantId, name, unit: p.unit[lang], price: p.price, currency: tenant.currency, renewalMonths: p.renewalMonths ?? null });
        products += 1;
      }

      const wonStage = (await tx.pipelineStage.findOne({ tenantId: ctx.tenantId, pipelineId: pipeline.id, kind: "won" }))!;
      const names = { inactive_call: { az: "Səssiz müştəriyə zəng", en: "Call quiet customers", ru: "Звонок молчащим клиентам" }, paid_won: { az: "Ödəniş → qazanıldı", en: "Paid → won", ru: "Оплата → выиграна" }, quote_thanks: { az: "Təklif qəbul olunanda təşəkkür", en: "Thanks when a quote is accepted", ru: "Спасибо за принятое КП" } };
      for (const a of tpl.automations) {
        const rule =
          a === "inactive_call"
            ? { trigger: "contact.inactive", conditions: { inactiveDays: 30 }, actions: [{ type: "create_task", title: `${names.inactive_call[lang]}: {title}`, dueInDays: 1, assignee: "owner", priority: "MEDIUM" }] }
            : a === "paid_won"
              ? { trigger: "invoice.paid", conditions: {}, actions: [{ type: "move_stage", stageId: wonStage.id }] }
              : { trigger: "quote.accepted", conditions: {}, actions: [{ type: "notify", recipient: "owner", message: `${names.quote_thanks[lang]}: {title}` }] };
        await tx.automationRule.insertOne({ tenantId: ctx.tenantId, name: names[a][lang], ...rule, enabled: false, createdById: ctx.membershipId } as never);
      }
      await tx.tenant.update({ id: ctx.tenantId }, { $addToSet: { "onboarding.templates": key } });
      await this.audit.log(tx, { action: "template.applied", entityType: "tenant", entityId: ctx.tenantId, diff: { key } });
      return { pipelineId: pipeline.id, fields, products, automations: tpl.automations.length };
    });
  }

  /** Sample customers, deals and tasks; their ids are kept so removal touches nothing else. */
  async addDemo(): Promise<OnboardingDto> {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const tenant = await tx.tenant.get({ id: ctx.tenantId });
      if (tenant.onboarding?.demo) throw new AppError("CONFLICT", "Sample data is already there");
      const d = DEMO[langOf(tenant.locale)];
      const pipeline = (await tx.pipeline.findOne({ tenantId: ctx.tenantId, isDefault: true }))!;
      const stages = await tx.pipelineStage.find({ tenantId: ctx.tenantId, pipelineId: pipeline.id, kind: "open" }, { sort: { order: 1 } });
      const contactIds: string[] = [];
      for (const [name, email, phone] of d.contacts) {
        const c = await tx.contact.insertOne({ tenantId: ctx.tenantId, type: name.includes("MMC") || name.includes("Ltd") || name.includes("ООО") ? "company" : "person", name, email, phone, stage: "LEAD", source: "manual", tags: ["demo"], customFields: {}, ownerId: ctx.membershipId, lastActivityAt: new Date() });
        contactIds.push(c.id);
      }
      const dealIds: string[] = [];
      for (const [i, [title, amount]] of d.deals.entries()) {
        const deal = await tx.deal.insertOne({ tenantId: ctx.tenantId, pipelineId: pipeline.id, stageId: stages[Math.min(i + 1, stages.length - 1)]!.id, title, amount, currency: tenant.currency, baseAmount: amount, customFields: {}, contactId: contactIds[i] ?? null, ownerId: ctx.membershipId, expectedClose: new Date(Date.now() + (i + 1) * 7 * DAY_MS), position: 1024 * (i + 1) });
        dealIds.push(deal.id);
      }
      const taskIds: string[] = [];
      for (const [i, title] of d.tasks.entries()) {
        const task = await tx.task.insertOne({ tenantId: ctx.tenantId, title, creatorId: ctx.membershipId, assigneeId: ctx.membershipId, dueAt: new Date(Date.now() + (i + 1) * DAY_MS), contactId: contactIds[i] ?? null });
        taskIds.push(task.id);
      }
      await tx.tenant.update({ id: ctx.tenantId }, { $set: { "onboarding.demo": { contactIds, dealIds, taskIds } } });
    });
    return this.state();
  }

  async removeDemo(): Promise<OnboardingDto> {
    const ctx = authedContext();
    await this.db.scoped(async (tx: Tx) => {
      const tenant = await tx.tenant.get({ id: ctx.tenantId });
      const demo = tenant.onboarding?.demo;
      if (!demo) return;
      await tx.task.deleteMany({ tenantId: ctx.tenantId, id: { $in: demo.taskIds } });
      await tx.deal.deleteMany({ tenantId: ctx.tenantId, id: { $in: demo.dealIds } });
      await tx.activity.deleteMany({ tenantId: ctx.tenantId, contactId: { $in: demo.contactIds } });
      await tx.contact.deleteMany({ tenantId: ctx.tenantId, id: { $in: demo.contactIds } });
      await tx.tenant.update({ id: ctx.tenantId }, { $set: { "onboarding.demo": null } });
      await this.audit.log(tx, { action: "demo.removed", entityType: "tenant", entityId: ctx.tenantId });
    });
    return this.state();
  }
}
