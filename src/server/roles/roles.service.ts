import { ROLE_GRANTABLE, type Permission, type RoleDto, type RoleInput } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import type { Database, Tx } from "../db/database";
import type { Role } from "../db/models";
import { countBy } from "../db/query";

const MAX_ROLES = 30;

/** Members (active or invited) holding a role: disabled members don't count. */
const HOLDERS = { status: { $in: ["ACTIVE", "INVITED"] } };

const dto = (r: Role, members: number): RoleDto => ({
  id: r.id,
  name: r.name,
  description: r.description,
  permissions: r.permissions.filter((p): p is Permission => (ROLE_GRANTABLE as readonly string[]).includes(p)),
  members,
  createdAt: r.createdAt.toISOString(),
});

/**
 * Nobody hands out more than they have: a role (or assigning one) may only carry
 * permissions the acting member holds themselves.
 */
export function assertWithinOwn(ctx: AuthedContext, permissions: readonly string[]) {
  const extra = permissions.filter((p) => !ctx.permissions.includes(p as Permission));
  if (extra.length) throw forbidden(`You cannot grant permissions you don't have: ${extra.join(", ")}`);
}

/** Company-defined roles: named permission sets that replace a member's built-in role. */
export class RolesService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RoleDto[]> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const [rows, counts] = await Promise.all([tx.role.find({ tenantId }, { sort: { name: 1 } }), countBy(tx.membership, "roleId", { tenantId, roleId: { $ne: null }, ...HOLDERS })]);
      return rows.map((r) => dto(r, counts.get(r.id)?.count ?? 0));
    });
  }

  async create(input: RoleInput): Promise<RoleDto> {
    const ctx = authedContext();
    assertWithinOwn(ctx, input.permissions);
    return this.db.scoped(async (tx) => {
      if ((await tx.role.count({ tenantId: ctx.tenantId })) >= MAX_ROLES) throw new AppError("CONFLICT", `At most ${MAX_ROLES} roles per company`);
      await this.assertNameFree(tx, ctx.tenantId, input.name);
      const role = await tx.role.insertOne({ tenantId: ctx.tenantId, name: input.name, description: input.description || null, permissions: [...new Set(input.permissions)] });
      await this.audit.log(tx, { action: "role.created", entityType: "role", entityId: role.id, diff: { name: role.name, permissions: role.permissions } });
      return dto(role, 0);
    });
  }

  async update(id: string, input: RoleInput): Promise<RoleDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const current = await tx.role.findOne({ id, tenantId: ctx.tenantId });
      if (!current) throw notFound("Role");
      // Only what changes has to be within the editor's own rights: an admin without
      // some permission can still rename a role that carries it
      const added = input.permissions.filter((p) => !current.permissions.includes(p));
      const removed = current.permissions.filter((p) => !input.permissions.includes(p as Permission));
      assertWithinOwn(ctx, [...added, ...removed]);
      if (input.name.toLowerCase() !== current.name.toLowerCase()) await this.assertNameFree(tx, ctx.tenantId, input.name);
      const role = await tx.role.update({ id }, { $set: { name: input.name, description: input.description || null, permissions: [...new Set(input.permissions)] } });
      const diff: Record<string, unknown> = {};
      if (current.name !== role.name) diff.name = { from: current.name, to: role.name };
      if (added.length) diff.added = added;
      if (removed.length) diff.removed = removed;
      if (Object.keys(diff).length) await this.audit.log(tx, { action: "role.updated", entityType: "role", entityId: id, diff: diff as never });
      return dto(role, await tx.membership.count({ tenantId: ctx.tenantId, roleId: id, ...HOLDERS }));
    });
  }

  /** Only unused roles can go: members are never left without a role. */
  async remove(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const current = await tx.role.findOne({ id, tenantId: ctx.tenantId });
      if (!current) throw notFound("Role");
      assertWithinOwn(ctx, current.permissions);
      const holders = await tx.membership.count({ tenantId: ctx.tenantId, roleId: id });
      if (holders) throw new AppError("ROLE_IN_USE", "Move the members to another role first", { members: holders });
      await tx.role.delete({ id });
      await this.audit.log(tx, { action: "role.deleted", entityType: "role", entityId: id, diff: { name: current.name } });
    });
  }

  private async assertNameFree(tx: Tx, tenantId: string, name: string) {
    const taken = (await tx.role.find({ tenantId }, { projection: { name: 1 } })).some((r) => r.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new AppError("CONFLICT", "A role with this name exists", { name: ["Taken"] });
  }
}
