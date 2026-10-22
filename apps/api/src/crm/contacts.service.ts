import { Injectable } from "@nestjs/common";
import type { Contact, Prisma } from "@prisma/client";
import type {
  ActivityDto,
  ContactCreateInput,
  ContactDetailDto,
  ContactDto,
  ContactListQuery,
  ContactListResponse,
  ContactUpdateInput,
} from "@axis/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext, type AuthedContext } from "../common/context";
import { notFound } from "../common/errors";
import { PrismaService, type Tx } from "../prisma/prisma.service";
import { ActivityService, TIMELINE_ORDER } from "./activity.service";
import { dealToDto } from "./deals.service";
import { memberRefs, ownerScope, resolveOwner } from "./scope";

type ContactWithCount = Contact & { _count: { deals: number } };

const OPEN_DEALS = { _count: { select: { deals: { where: { stage: { kind: "open" } } } } } } as const;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ContactListQuery): Promise<ContactListResponse> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const { where: scoped } = await ownerScope(tx, ctx, "contacts.view_all");
      const q = query.q?.trim();
      const where: Prisma.ContactWhereInput = {
        AND: [
          { tenantId: ctx.tenantId, deletedAt: null },
          scoped,
          query.stage ? { stage: query.stage } : {},
          query.ownerId ? { ownerId: query.ownerId === "none" ? null : query.ownerId } : {},
          q
            ? {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { email: { contains: q, mode: "insensitive" } },
                  { companyName: { contains: q, mode: "insensitive" } },
                  { phone: { contains: q.replace(/[\s()-]/g, "") } },
                ],
              }
            : {},
        ],
      };
      const [rows, total] = await Promise.all([
        tx.contact.findMany({
          where,
          include: OPEN_DEALS,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: query.limit + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        }),
        tx.contact.count({ where }),
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
    return this.prisma.scoped(async (tx) => {
      const contact = await this.findVisible(tx, ctx, id);
      const deals = await tx.deal.findMany({
        where: { tenantId: ctx.tenantId, contactId: id },
        include: { contact: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      });
      const refs = await memberRefs(tx, ctx.tenantId, [contact.ownerId, ...deals.map((d) => d.ownerId)]);
      const [dto] = await this.toDtos(tx, ctx.tenantId, [contact]);
      return { ...dto!, deals: deals.map((d) => dealToDto(d, refs)) };
    });
  }

  async create(input: ContactCreateInput): Promise<ContactDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const ownerId = await resolveOwner(tx, ctx, input.ownerId, ctx.membershipId);
      const contact = await tx.contact.create({
        data: {
          tenantId: ctx.tenantId,
          type: input.type,
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          companyName: input.companyName ?? null,
          stage: input.stage,
          source: input.source,
          tags: input.tags,
          ownerId,
        },
        include: OPEN_DEALS,
      });
      await this.activity.record(tx, { type: "contact_created", contactId: contact.id, payload: { contactName: contact.name } });
      return (await this.toDtos(tx, ctx.tenantId, [contact]))[0]!;
    });
  }

  async update(id: string, input: ContactUpdateInput): Promise<ContactDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const current = await this.findVisible(tx, ctx, id);
      const ownerId = input.ownerId !== undefined ? await resolveOwner(tx, ctx, input.ownerId, null) : undefined;
      const updated = await tx.contact.update({
        where: { id },
        data: {
          type: input.type,
          name: input.name,
          email: input.email,
          phone: input.phone,
          companyName: input.companyName,
          stage: input.stage,
          source: input.source,
          tags: input.tags,
          ownerId,
        },
        include: OPEN_DEALS,
      });
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
    await this.prisma.scoped(async (tx) => {
      const current = await this.findVisible(tx, ctx, id);
      await tx.contact.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(tx, { action: "contact.deleted", entityType: "contact", entityId: id, diff: { name: current.name } });
    });
  }

  async activities(id: string): Promise<ActivityDto[]> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      await this.findVisible(tx, ctx, id);
      const rows = await tx.activity.findMany({ where: { tenantId: ctx.tenantId, contactId: id }, orderBy: TIMELINE_ORDER, take: 100 });
      return this.activity.toDtos(tx, ctx.tenantId, rows);
    });
  }

  async addNote(id: string, body: string): Promise<ActivityDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const contact = await this.findVisible(tx, ctx, id);
      const row = await this.activity.record(tx, { type: "note", contactId: id, payload: { body, contactName: contact.name } });
      return (await this.activity.toDtos(tx, ctx.tenantId, [row]))[0]!;
    });
  }

  /** Not found and not visible look the same, so ids can't be probed across scopes. */
  async findVisible(tx: Tx, ctx: AuthedContext, id: string) {
    const { where } = await ownerScope(tx, ctx, "contacts.view_all");
    const contact = await tx.contact.findFirst({
      where: { AND: [{ id, tenantId: ctx.tenantId, deletedAt: null }, where] },
      include: OPEN_DEALS,
    });
    if (!contact) throw notFound("Contact");
    return contact;
  }

  private async toDtos(tx: Tx, tenantId: string, rows: ContactWithCount[]): Promise<ContactDto[]> {
    const refs = await memberRefs(tx, tenantId, rows.map((r) => r.ownerId));
    return rows.map((c) => {
      const owner = c.ownerId ? refs.get(c.ownerId) : undefined;
      return {
        id: c.id,
        type: c.type === "company" ? "company" : "person",
        name: c.name,
        email: c.email,
        phone: c.phone,
        companyName: c.companyName,
        stage: c.stage,
        source: c.source,
        tags: c.tags,
        owner: owner ? { id: owner.id, name: owner.name } : null,
        openDeals: c._count.deals,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };
    });
  }
}
