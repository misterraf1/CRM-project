import type { CustomFieldValues, CustomObjectDto, CustomRecordDto, FieldType, ObjectIcon } from "@/shared";
import type { z } from "zod";
import type { objectCreateSchema, objectUpdateSchema, recordInputSchema, recordListQuerySchema } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import type { Database, Tx } from "../db/database";
import type { CustomObject, CustomRecord, FieldDefinition } from "../db/models";
import { contains } from "../db/query";
import { createId } from "../db/repo";
import { memberRefs, ownerScope } from "./scope";
import { applyCustomFields } from "./settings.service";

type FieldInput = z.infer<typeof objectCreateSchema>["fields"][number];

/**
 * A company's own sections ("Cars", "Properties", "Courses"): an admin defines the
 * section and its fields; everyone in the company sees its records, members who can
 * edit customers create and change them. A record may belong to a customer.
 */
export class ObjectsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ─── Sections ───────────────────────────────────────────────

  async list(): Promise<CustomObjectDto[]> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const [objects, counts] = await Promise.all([
        tx.customObject.find({ tenantId: ctx.tenantId }, { sort: { createdAt: 1 } }),
        tx.customRecord.aggregate<{ _id: string; n: number }>([{ $match: { tenantId: ctx.tenantId } }, { $group: { _id: "$objectId", n: { $sum: 1 } } }]),
      ]);
      const n = new Map(counts.map((c) => [c._id, c.n]));
      return objects.map((o) => toObjectDto(o, n.get(o.id) ?? 0));
    });
  }

  async create(input: z.infer<typeof objectCreateSchema>): Promise<CustomObjectDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      if ((await tx.customObject.count({ tenantId: ctx.tenantId })) >= 10) throw new AppError("CONFLICT", "At most 10 custom sections");
      const row = await tx.customObject.insertOne({ tenantId: ctx.tenantId, name: input.name, singular: input.singular, icon: input.icon, fields: mergeFields([], input.fields), createdById: ctx.membershipId });
      await this.audit.log(tx, { action: "object.created", entityType: "custom_object", entityId: row.id, diff: { name: input.name } });
      return toObjectDto(row, 0);
    });
  }

  async update(id: string, input: z.infer<typeof objectUpdateSchema>): Promise<CustomObjectDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const current = await tx.customObject.findOne({ id, tenantId: ctx.tenantId });
      if (!current) throw notFound("Section");
      const set: Partial<CustomObject> = {
        ...(input.name ? { name: input.name } : {}),
        ...(input.singular ? { singular: input.singular } : {}),
        ...(input.icon ? { icon: input.icon } : {}),
        ...(input.fields ? { fields: mergeFields(current.fields, input.fields) } : {}),
      };
      const row = (await tx.customObject.findOneAndUpdate({ id, tenantId: ctx.tenantId }, { $set: set }))!;
      await this.audit.log(tx, { action: "object.updated", entityType: "custom_object", entityId: id, diff: { name: row.name, fields: row.fields.filter((f) => !f.archived).map((f) => f.label) } });
      return toObjectDto(row, await tx.customRecord.count({ tenantId: ctx.tenantId, objectId: id }));
    });
  }

  /** Only an empty section can go (records are never deleted along with it). */
  async remove(id: string): Promise<CustomObjectDto[]> {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      if (!(await tx.customObject.count({ id, tenantId: ctx.tenantId }))) throw notFound("Section");
      if (await tx.customRecord.count({ tenantId: ctx.tenantId, objectId: id })) throw new AppError("CONFLICT", "The section still has records");
      await tx.customObject.deleteMany({ id, tenantId: ctx.tenantId });
      await this.audit.log(tx, { action: "object.deleted", entityType: "custom_object", entityId: id });
    });
    return this.list();
  }

  // ─── Records ────────────────────────────────────────────────

  async records(objectId: string, q: z.infer<typeof recordListQuerySchema>): Promise<{ items: CustomRecordDto[]; total: number }> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      await this.object(tx, ctx, objectId);
      const where = { tenantId: ctx.tenantId, objectId, ...(q.contactId ? { contactId: q.contactId } : {}), ...(q.q ? { title: contains(q.q) } : {}) };
      const [rows, total] = await Promise.all([
        tx.customRecord.find(where, { sort: { updatedAt: -1, id: -1 }, skip: (q.page - 1) * q.limit, limit: q.limit }),
        tx.customRecord.count(where),
      ]);
      return { items: await this.toDtos(tx, ctx, rows), total };
    });
  }

  async get(id: string): Promise<CustomRecordDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const row = await tx.customRecord.findOne({ id, tenantId: ctx.tenantId });
      if (!row) throw notFound("Record");
      return (await this.toDtos(tx, ctx, [row]))[0]!;
    });
  }

  async createRecord(objectId: string, input: z.infer<typeof recordInputSchema>): Promise<CustomRecordDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const object = await this.object(tx, ctx, objectId);
      const values = applyCustomFields(defsOf(object), input.values as CustomFieldValues, null);
      if (input.contactId) await this.visibleContact(tx, ctx, input.contactId);
      const row = await tx.customRecord.insertOne({ tenantId: ctx.tenantId, objectId, title: input.title, values: values as CustomRecord["values"], contactId: input.contactId ?? null, ownerId: ctx.membershipId });
      await this.audit.log(tx, { action: "record.created", entityType: "custom_record", entityId: row.id, diff: { object: object.name, title: input.title } });
      return (await this.toDtos(tx, ctx, [row]))[0]!;
    });
  }

  async updateRecord(id: string, input: Partial<z.infer<typeof recordInputSchema>>): Promise<CustomRecordDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const current = await tx.customRecord.findOne({ id, tenantId: ctx.tenantId });
      if (!current) throw notFound("Record");
      const object = await this.object(tx, ctx, current.objectId);
      const values = input.values ? applyCustomFields(defsOf(object), input.values as CustomFieldValues, (current.values ?? {}) as Record<string, unknown>) : undefined;
      if (input.contactId) await this.visibleContact(tx, ctx, input.contactId);
      const row = await tx.customRecord.update(
        { id, tenantId: ctx.tenantId },
        { $set: { ...(input.title ? { title: input.title } : {}), ...(values ? { values: values as CustomRecord["values"] } : {}), ...(input.contactId !== undefined ? { contactId: input.contactId } : {}) } },
      );
      return (await this.toDtos(tx, ctx, [row]))[0]!;
    });
  }

  async removeRecord(id: string): Promise<void> {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const row = await tx.customRecord.findOne({ id, tenantId: ctx.tenantId });
      if (!row) throw notFound("Record");
      await tx.customRecord.deleteMany({ id, tenantId: ctx.tenantId });
      await this.audit.log(tx, { action: "record.deleted", entityType: "custom_record", entityId: id, diff: { title: row.title, values: row.values } });
    });
  }

  private async object(tx: Tx, ctx: AuthedContext, id: string) {
    const object = await tx.customObject.findOne({ id, tenantId: ctx.tenantId });
    if (!object) throw notFound("Section");
    return object;
  }

  private async visibleContact(tx: Tx, ctx: AuthedContext, contactId: string) {
    const { where } = await ownerScope(tx, ctx, "contacts.view_all");
    if (!(await tx.contact.count({ id: contactId, tenantId: ctx.tenantId, deletedAt: null, ...where }))) throw new AppError("VALIDATION_FAILED", "Unknown customer", { contactId: ["unknown"] });
  }

  private async toDtos(tx: Tx, ctx: AuthedContext, rows: CustomRecord[]): Promise<CustomRecordDto[]> {
    const contactIds = [...new Set(rows.map((r) => r.contactId).filter((v): v is string => !!v))];
    const [contacts, refs] = await Promise.all([
      contactIds.length ? tx.contact.find({ tenantId: ctx.tenantId, id: { $in: contactIds } }, { projection: { id: 1, name: 1 } }) : [],
      memberRefs(tx, ctx.tenantId, rows.map((r) => r.ownerId)),
    ]);
    const names = new Map(contacts.map((c) => [c.id, c.name]));
    return rows.map((r) => {
      const owner = r.ownerId ? refs.get(r.ownerId) : undefined;
      return {
        id: r.id,
        objectId: r.objectId,
        title: r.title,
        values: (r.values ?? {}) as CustomFieldValues,
        contact: r.contactId && names.has(r.contactId) ? { id: r.contactId, name: names.get(r.contactId)! } : null,
        owner: owner ? { id: owner.id, name: owner.name } : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }
}

/** Keeps ids of kept fields (and their type: stored values depend on it); fields left out are archived, never dropped. */
function mergeFields(current: CustomObject["fields"], input: FieldInput[]): CustomObject["fields"] {
  const byId = new Map(current.map((f) => [f.id, f]));
  const kept = input.map((f) => {
    const old = f.id ? byId.get(f.id) : undefined;
    if (f.id && !old) throw new AppError("VALIDATION_FAILED", "Unknown field", { fields: ["unknown"] });
    return { id: old?.id ?? createId(), label: f.label, type: old?.type ?? f.type, options: f.options, required: f.required, archived: false };
  });
  const keptIds = new Set(kept.map((f) => f.id));
  return [...kept, ...current.filter((f) => !keptIds.has(f.id)).map((f) => ({ ...f, archived: true, required: false }))];
}

/** The section's live fields shaped like custom field definitions, for the shared validator. */
const defsOf = (o: CustomObject) =>
  o.fields.filter((f) => !f.archived).map((f, order) => ({ ...f, tenantId: o.tenantId, entity: "deal", order, createdAt: o.createdAt, updatedAt: o.updatedAt }) as unknown as FieldDefinition);

function toObjectDto(o: CustomObject, records: number): CustomObjectDto {
  return {
    id: o.id,
    name: o.name,
    singular: o.singular,
    icon: o.icon as ObjectIcon,
    fields: o.fields.filter((f) => !f.archived).map((f) => ({ id: f.id, label: f.label, type: f.type as FieldType, options: f.options, required: f.required })),
    records,
  };
}
