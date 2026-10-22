import type { Permission } from "@axis/shared";
import type { AuthedContext } from "../common/context";
import { AppError, forbidden } from "../common/errors";
import type { Tx } from "../prisma/prisma.service";

export type Scope = "all" | "department" | "own";

export interface OwnerScope {
  scope: Scope;
  /** Membership ids whose records are visible; null = everything */
  memberIds: string[] | null;
  /** Prisma `where` fragment for tables with an `ownerId` column */
  where: { ownerId?: string } | { OR: ({ ownerId: { in: string[] } } | { ownerId: null })[] } | Record<string, never>;
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
    const ids = ctx.departmentId
      ? (await tx.membership.findMany({ where: { tenantId: ctx.tenantId, departmentId: ctx.departmentId }, select: { id: true } })).map(
          (m) => m.id,
        )
      : [];
    const memberIds = [...new Set([ctx.membershipId, ...ids])];
    return { scope: "department", memberIds, where: { OR: [{ ownerId: { in: memberIds } }, { ownerId: null }] } };
  }

  return { scope: "own", memberIds: [ctx.membershipId], where: { ownerId: ctx.membershipId } };
}

/** Resolves membership ids to display refs (ownerId columns have no FK relation). */
export async function memberRefs(tx: Tx, tenantId: string, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map<string, { id: string; name: string; title: string | null }>();
  const rows = await tx.membership.findMany({
    where: { tenantId, id: { in: unique } },
    select: { id: true, title: true, user: { select: { fullName: true } } },
  });
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.user.fullName, title: r.title }]));
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
  if (ownerId && !(await tx.membership.count({ where: { id: ownerId, tenantId: ctx.tenantId, status: "ACTIVE" } }))) {
    throw new AppError("VALIDATION_FAILED", "Unknown owner", { ownerId: ["Unknown member"] });
  }
  return ownerId;
}
