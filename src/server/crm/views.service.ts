import type { SavedViewDto, ViewEntity } from "@/shared";
import type { z } from "zod";
import type { savedViewCreateSchema } from "@/shared";
import { authedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import type { Database } from "../db/database";
import type { SavedView } from "../db/models";

/** Saved list filters: a member's own, and team-wide ones set up by an admin. */
export class ViewsService {
  constructor(private readonly db: Database) {}

  async list(entity: ViewEntity): Promise<SavedViewDto[]> {
    const ctx = authedContext();
    const rows = await this.db.read((tx) =>
      tx.savedView.find({ tenantId: ctx.tenantId, entity, $or: [{ ownerId: ctx.membershipId }, { shared: true }] }, { sort: { shared: -1, createdAt: 1 } }),
    );
    return rows.map((v) => toDto(v, ctx.membershipId));
  }

  async create(input: z.infer<typeof savedViewCreateSchema>): Promise<SavedViewDto[]> {
    const ctx = authedContext();
    if (input.shared && !ctx.permissions.includes("crm.configure")) throw forbidden("Requires permission crm.configure");
    // The page number is not part of a view
    const params = new URLSearchParams(input.query.replace(/^\?/, ""));
    params.delete("page");
    await this.db.scoped(async (tx) => {
      if ((await tx.savedView.count({ tenantId: ctx.tenantId, ownerId: ctx.membershipId, entity: input.entity })) >= 30) throw new AppError("CONFLICT", "At most 30 saved views");
      await tx.savedView.insertOne({ tenantId: ctx.tenantId, ownerId: ctx.membershipId, entity: input.entity, name: input.name, query: params.toString(), shared: input.shared });
    });
    return this.list(input.entity);
  }

  async remove(id: string): Promise<SavedViewDto[]> {
    const ctx = authedContext();
    const view = await this.db.read((tx) => tx.savedView.findOne({ id, tenantId: ctx.tenantId }));
    if (!view || (view.ownerId !== ctx.membershipId && !view.shared)) throw notFound("View");
    // Someone else's team view: only admins remove it
    if (view.ownerId !== ctx.membershipId && !ctx.permissions.includes("crm.configure")) throw forbidden("Requires permission crm.configure");
    await this.db.scoped((tx) => tx.savedView.deleteMany({ id, tenantId: ctx.tenantId }));
    return this.list(view.entity as ViewEntity);
  }
}

const toDto = (v: SavedView, me: string): SavedViewDto => ({ id: v.id, name: v.name, query: v.query, shared: v.shared, mine: v.ownerId === me });
