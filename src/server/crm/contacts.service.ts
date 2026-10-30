import { AutomationRunner } from "../automations/automation.runner";
import type { Contact } from "../db/models";
import type {
  DuplicateMatchesDto,
  ActivityDto,
  ContactCreateInput,
  ContactDetailDto,
  ContactDto,
  ContactListQuery,
  ContactListResponse,
  ContactUpdateInput,
} from "@/shared";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../billing/entitlements.service";
import { mentionedMembers } from "../notifications/mentions";
import { NotificationsService } from "../notifications/notifications.service";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import type { Database, Tx } from "../db/database";
import { and, contains } from "../db/query";
import { ActivityService, TIMELINE_ORDER } from "./activity.service";
import { dealToDto, withContacts } from "./deals.service";
import { memberRefs, ownerScope, resolveOwner } from "./scope";
import { checkCustomFields, contactEntity, customFieldFilter } from "./settings.service";

/** The company a person is linked to: a live company contact of the same tenant. */
async function resolveCompany(tx: Tx, tenantId: string, companyId: string) {
  const company = await tx.contact.findOne({ id: companyId, tenantId, type: "company", deletedAt: null }, { projection: { id: 1, name: 1 } });
  if (!company) throw new AppError("VALIDATION_FAILED", "Unknown company", { companyId: ["Unknown company"] });
  return company;
}

/** Open deals per contact (deals in an open stage). */
async function openDealCounts(tx: Tx, tenantId: string, contactIds: string[]) {
  if (!contactIds.length) return new Map<string, number>();
  const openStages = (await tx.pipelineStage.find({ tenantId, kind: "open" }, { projection: { id: 1 } })).map((s) => s.id);
  const rows = await tx.deal.aggregate<{ _id: string; n: number }>([
    { $match: { tenantId, contactId: { $in: contactIds }, stageId: { $in: openStages } } },
    { $group: { _id: "$contactId", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

/** The contact list's filter (visibility plus the list's query), shared by the list and its export. */
export async function contactListWhere(tx: Tx, ctx: AuthedContext, query: Omit<ContactListQuery, "cursor" | "limit">) {
  const { where: scoped } = await ownerScope(tx, ctx, "contacts.view_all");
  const q = query.q?.trim();
  const fieldFilter = query.field && query.value ? await customFieldFilter(tx, ctx.tenantId, query.field, query.value) : {};
  return and(
    { tenantId: ctx.tenantId, deletedAt: null },
    scoped,
    query.stage ? { stage: query.stage } : {},
    query.ownerId ? { ownerId: query.ownerId === "none" ? null : query.ownerId } : {},
    query.type ? { type: query.type } : {},
    query.source ? { source: query.source } : {},
    query.tag ? { tags: query.tag } : {},
    query.companyId ? { companyId: query.companyId } : {},
    fieldFilter,
    q ? { $or: [{ name: contains(q) }, { email: contains(q) }, { companyName: contains(q) }, { phone: contains(q.replace(/[\s()-]/g, ""), false) }] } : {},
  );
}

export class ContactsService {
  constructor(
    private readonly db: Database,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly automations: AutomationRunner,
    private readonly entitlements: EntitlementsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ContactListQuery): Promise<ContactListResponse> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const where = await contactListWhere(tx, ctx, query);
      // Keyset pagination: rows after the cursor in (createdAt desc, id desc) order
      const cursor = query.cursor ? await tx.contact.findOne({ id: query.cursor, tenantId: ctx.tenantId }, { projection: { id: 1, createdAt: 1 } }) : null;
      const after = cursor ? { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { $lt: cursor.id } }] } : {};
      const [rows, total] = await Promise.all([
        tx.contact.find(and(where, after), { sort: { createdAt: -1, id: -1 }, limit: query.limit + 1 }),
        tx.contact.count(where),
      ]);
      const page = rows.slice(0, query.limit);
      return {
        items: await this.toDtos(tx, ctx.tenantId, page),
        nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
        total,
      };
    });
  }

  async get(id: string): Promise<ContactDetailDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const contact = await this.findVisible(tx, ctx, id);
      const { where: scoped } = await ownerScope(tx, ctx, "contacts.view_all");
      const people =
        contact.type === "company"
          ? await tx.contact.find(and({ tenantId: ctx.tenantId, companyId: id, deletedAt: null }, scoped), {
              sort: { name: 1 },
              limit: 100,
              projection: { id: 1, name: 1, email: 1, phone: 1 },
            })
          : [];
      // A company's deals include those of its people
      const dealContacts = [id, ...people.map((p) => p.id)];
      const deals = await withContacts(
        tx,
        ctx.tenantId,
        await tx.deal.find(and({ tenantId: ctx.tenantId, contactId: { $in: dealContacts } }, scoped), { sort: { createdAt: -1 } }),
      );
      const refs = await memberRefs(tx, ctx.tenantId, [contact.ownerId, ...deals.map((d) => d.ownerId)]);
      const [dto] = await this.toDtos(tx, ctx.tenantId, [contact]);
      return {
        ...dto!,
        deals: deals.map((d) => dealToDto(d, refs)),
        people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, phone: p.phone })),
      };
    });
  }

  /**
   * Contacts with the same email or phone (the last 9 digits, so +994 50… and 050… meet).
   * Matches outside the caller's view are only counted: their names stay private.
   */
  async duplicates(q: { email?: string; phone?: string; excludeId?: string }): Promise<DuplicateMatchesDto> {
    const ctx = authedContext();
    const digits = (q.phone ?? "").replace(/\D/g, "");
    const or = [
      ...(q.email && q.email.includes("@") ? [{ email: q.email }] : []),
      ...(digits.length >= 7 ? [{ phone: { $regex: `${digits.slice(-9)}$` } }] : []),
    ];
    if (!or.length) return { items: [], hidden: 0 };
    return this.db.scoped(async (tx) => {
      const where = { tenantId: ctx.tenantId, deletedAt: null, $or: or, ...(q.excludeId ? { id: { $ne: q.excludeId } } : {}) };
      const [all, scope] = await Promise.all([
        tx.contact.find(where, { limit: 20, projection: { id: 1, name: 1, email: 1, phone: 1, ownerId: 1 } }),
        ownerScope(tx, ctx, "contacts.view_all"),
      ]);
      const visible = all.filter((c) => !scope.memberIds || (c.ownerId ? scope.memberIds.includes(c.ownerId) : scope.scope === "department"));
      return {
        items: visible.slice(0, 5).map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, match: q.email && c.email === q.email ? ("email" as const) : ("phone" as const) })),
        hidden: all.length - visible.length,
      };
    });
  }

  /**
   * Records the customer's permission for messages we start. Their open conversations
   * follow it (an opt-out blocks WhatsApp templates there too).
   */
  async setConsent(id: string, status: "opted_in" | "opted_out" | null) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const { where } = await ownerScope(tx, ctx, "contacts.view_all");
      const c = await tx.contact.findOne(and({ id, tenantId: ctx.tenantId, deletedAt: null }, where));
      if (!c) throw notFound("Contact");
      const at = new Date();
      await tx.contact.update({ id }, { $set: { messagingConsent: status ? { status, at, source: "manual" } : null } });
      await tx.conversation.updateMany({ tenantId: ctx.tenantId, contactId: id }, { $set: { optedOutAt: status === "opted_out" ? at : null } });
      await this.audit.log(tx, { action: "contact.consent_changed", entityType: "contact", entityId: id, diff: { from: c.messagingConsent?.status ?? null, to: status } });
    });
  }

  async create(input: ContactCreateInput): Promise<ContactDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      await this.entitlements.assertCapacity(tx, ctx.tenantId, "contacts");
      const ownerId = await resolveOwner(tx, ctx, input.ownerId, ctx.membershipId);
      const company = input.type === "person" && input.companyId ? await resolveCompany(tx, ctx.tenantId, input.companyId) : null;
      const customFields = await checkCustomFields(tx, ctx.tenantId, contactEntity(input.type), input.customFields, null);
      const contact = await tx.contact.insertOne({
        tenantId: ctx.tenantId,
        type: input.type,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        companyName: company?.name ?? (input.type === "person" ? (input.companyName ?? null) : null),
        companyId: company?.id ?? null,
        stage: input.stage,
        source: input.source,
        tags: input.tags,
        customFields: (customFields ?? {}) as Contact["customFields"],
        ownerId,
      });
      await this.activity.record(tx, { type: "contact_created", contactId: contact.id, payload: { contactName: contact.name } });
      await this.automations.enqueue(tx, ctx.tenantId, "contact.created", { contactId: contact.id });
      return (await this.toDtos(tx, ctx.tenantId, [contact]))[0]!;
    });
  }

  async update(id: string, input: ContactUpdateInput): Promise<ContactDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const current = await this.findVisible(tx, ctx, id);
      const ownerId = input.ownerId !== undefined ? await resolveOwner(tx, ctx, input.ownerId, null) : undefined;
      const type = input.type ?? current.type;
      if (type === "person" && current.type === "company" && (await tx.contact.count({ tenantId: ctx.tenantId, companyId: id, deletedAt: null }))) {
        throw new AppError("CONFLICT", "People are linked to this company", { type: ["Has people"] });
      }
      // Company link: an explicit companyId wins; a typed name unlinks; companies have none
      let company: { companyId?: string | null; companyName?: string | null } = {};
      if (type === "company") company = { companyId: null, companyName: null };
      else if (input.companyId) {
        const c = await resolveCompany(tx, ctx.tenantId, input.companyId);
        if (c.id === id) throw new AppError("VALIDATION_FAILED", "A contact can't be its own company", { companyId: ["Self"] });
        company = { companyId: c.id, companyName: c.name };
      } else if (input.companyId === null || input.companyName !== undefined) company = { companyId: null, companyName: input.companyName ?? null };
      const entityChanged = contactEntity(type) !== contactEntity(current.type);
      const customFields = await checkCustomFields(
        tx,
        ctx.tenantId,
        contactEntity(type),
        input.customFields ?? (entityChanged ? {} : undefined),
        entityChanged ? null : (current.customFields as Record<string, unknown>),
      );
      const updated = await tx.contact.update(
        { id },
        {
          $set: {
            type: input.type,
            name: input.name,
            email: input.email,
            phone: input.phone,
            ...company,
            stage: input.stage,
            source: input.source,
            tags: input.tags,
            customFields: customFields as Contact["customFields"] | undefined,
            ownerId,
          },
        },
      );
      // People show their company's name; keep it in step with a rename
      if (updated.type === "company" && input.name && input.name !== current.name) {
        await tx.contact.updateMany({ tenantId: ctx.tenantId, companyId: id }, { $set: { companyName: updated.name } });
      }
      if (input.stage && input.stage !== current.stage) {
        await this.activity.record(tx, {
          type: "contact_stage",
          contactId: id,
          payload: { contactName: updated.name, from: current.stage, to: input.stage },
        });
      }
      if (ownerId !== undefined && ownerId !== current.ownerId) {
        const refs = await memberRefs(tx, ctx.tenantId, [ownerId]);
        await this.activity.record(tx, {
          type: "owner_changed",
          contactId: id,
          payload: { contactName: updated.name, ownerName: ownerId ? (refs.get(ownerId)?.name ?? null) : null },
        });
      }
      return (await this.toDtos(tx, ctx.tenantId, [updated]))[0]!;
    });
  }

  /** Soft delete: the row and its history stay for restore and audit. */
  async remove(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const current = await this.findVisible(tx, ctx, id);
      await tx.contact.update({ id }, { $set: { deletedAt: new Date() } });
      await this.audit.log(tx, { action: "contact.deleted", entityType: "contact", entityId: id, diff: { name: current.name } });
    });
  }

  async activities(id: string): Promise<ActivityDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      await this.findVisible(tx, ctx, id);
      const rows = await tx.activity.find({ tenantId: ctx.tenantId, contactId: id }, { sort: TIMELINE_ORDER, limit: 100 });
      return this.activity.toDtos(tx, ctx.tenantId, rows);
    });
  }

  async addNote(id: string, body: string): Promise<ActivityDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const contact = await this.findVisible(tx, ctx, id);
      const row = await this.activity.record(tx, { type: "note", contactId: id, payload: { body, contactName: contact.name } });
      const mentioned = await mentionedMembers(tx, ctx.tenantId, body, [contact.ownerId], "contacts.view_all");
      if (mentioned.length) {
        const me = await tx.user.get({ id: ctx.userId }, { projection: { fullName: 1 } });
        await this.notifications.notify(tx, ctx.tenantId, mentioned, "mention", { title: contact.name, actorName: me.fullName, excerpt: body.slice(0, 140), contactId: id }, ctx.membershipId);
      }
      return (await this.activity.toDtos(tx, ctx.tenantId, [row]))[0]!;
    });
  }

  /** Not found and not visible look the same, so ids can't be probed across scopes. */
  async findVisible(tx: Tx, ctx: AuthedContext, id: string) {
    const { where } = await ownerScope(tx, ctx, "contacts.view_all");
    const contact = await tx.contact.findOne(and({ id, tenantId: ctx.tenantId, deletedAt: null }, where));
    if (!contact) throw notFound("Contact");
    return contact;
  }

  private async toDtos(tx: Tx, tenantId: string, rows: Contact[]): Promise<ContactDto[]> {
    const [refs, openDeals] = await Promise.all([memberRefs(tx, tenantId, rows.map((r) => r.ownerId)), openDealCounts(tx, tenantId, rows.map((r) => r.id))]);
    return rows.map((c) => {
      const owner = c.ownerId ? refs.get(c.ownerId) : undefined;
      return {
        id: c.id,
        type: c.type === "company" ? "company" : "person",
        name: c.name,
        email: c.email,
        phone: c.phone,
        companyName: c.companyName,
        companyId: c.companyId ?? null,
        stage: c.stage,
        source: c.source,
        tags: c.tags,
        customFields: (c.customFields ?? {}) as ContactDto["customFields"],
        owner: owner ? { id: owner.id, name: owner.name } : null,
        openDeals: openDeals.get(c.id) ?? 0,
        messagingConsent: c.messagingConsent ? { ...c.messagingConsent, at: c.messagingConsent.at.toISOString() } : null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };
    });
  }
}
