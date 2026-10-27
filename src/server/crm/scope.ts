import type { Permission } from "@/shared";
import type { AuthedContext } from "../common/context";
import { AppError, forbidden } from "../common/errors";
import type { Tx } from "../db/database";
import type { Filter } from "../db/repo";

export type Scope = "all" | "department" | "own";

export interface OwnerScope {
  scope: Scope;
  /** Membership ids whose records are visible; null = everything */
  memberIds: string[] | null;
  /** Filter fragment for collections with an `ownerId` field */
  where: Filter;
}

/**
 * Data visibility inside a tenant (docs/ARCHITECTURE.md §6):
 * - holders of `viewAll` (owner, admin) see everything
 * - managers see their department's records plus unassigned ones (to distribute leads)
 * - everyone else sees only records they own
 */
export async function ownerScope(tx: Tx, ctx: AuthedContext, viewAll: Permission): Promise<OwnerScope> {
  if (ctx.permissions.includes(viewAll)) return { scope: "all", memberIds: null, where: {} };

  if (ctx.role === "MANAGER") {
    const ids = ctx.departmentId ? await departmentMemberIds(tx, ctx.tenantId, ctx.departmentId) : [];
    const memberIds = [...new Set([ctx.membershipId, ...ids])];
    return { scope: "department", memberIds, where: { $or: [{ ownerId: { $in: memberIds } }, { ownerId: null }] } };
  }

  return { scope: "own", memberIds: [ctx.membershipId], where: { ownerId: ctx.membershipId } };
}

export async function departmentMemberIds(tx: Tx, tenantId: string, departmentId: string) {
  return (await tx.membership.find({ tenantId, departmentId }, { projection: { id: 1 } })).map((m) => m.id);
}

/** Resolves membership ids to display refs (ownerId fields are plain ids). */
export async function memberRefs(tx: Tx, tenantId: string, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map<string, { id: string; name: string; title: string | null }>();
  const rows = await tx.membership.find({ tenantId, id: { $in: unique } }, { projection: { id: 1, title: 1, userId: 1 } });
  const users = await userNames(tx, rows.map((r) => r.userId));
  return new Map(rows.map((r) => [r.id, { id: r.id, name: users.get(r.userId) ?? "", title: r.title }]));
}

/** Full names by user id. */
export async function userNames(tx: Tx, userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return new Map<string, string>();
  const users = await tx.user.find({ id: { $in: unique } }, { projection: { id: 1, fullName: 1 } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/**
 * Owner assignment: managers and up may assign any active member; others may only
 * keep records for themselves. `requested === undefined` falls back to `fallback`.
 */
export async function resolveOwner(tx: Tx, ctx: AuthedContext, requested: string | null | undefined, fallback: string | null) {
  const ownerId = requested === undefined ? fallback : requested;
  if (!ctx.permissions.includes("contacts.manage")) {
    if (ownerId !== ctx.membershipId) throw forbidden("Only managers can assign records to others");
    return ownerId;
  }
  if (ownerId && !(await tx.membership.count({ id: ownerId, tenantId: ctx.tenantId, status: "ACTIVE" }))) {
    throw new AppError("VALIDATION_FAILED", "Unknown owner", { ownerId: ["Unknown member"] });
  }
  return ownerId;
}
