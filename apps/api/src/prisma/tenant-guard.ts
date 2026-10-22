import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";

/**
 * Tenant isolation for MongoDB (which has no row-level security).
 *
 * Every Prisma operation passes through `tenantGuard` (registered once in
 * PrismaService). On a tenant-owned model it:
 *  - narrows reads to the current tenant (and, for Membership/Tenant, to the
 *    caller's own memberships — needed for login and the workspace switcher),
 *  - narrows updates/deletes to the current tenant,
 *  - rejects creates for another tenant and any change of `tenantId`,
 *  - matches nothing / rejects writes when there is no tenant context (fail closed).
 * Platform code that must work across tenants (webhooks, background jobs) opts out
 * explicitly with `PrismaService.system()`.
 */

export interface DbScope {
  tenantId?: string;
  userId?: string;
  /** Explicit, audited bypass for cross-tenant platform operations */
  system?: boolean;
}

export const dbScope = new AsyncLocalStorage<DbScope>();

/** Models that carry `tenantId`, derived from the schema so a new model can't be forgotten. */
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "tenantId"))
    // Refresh tokens are looked up by hash before any identity exists
    .filter((m) => m.name !== "Session")
    .map((m) => m.name),
);

const READS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);
const SCOPED_WRITES = new Set(["update", "updateMany", "delete", "deleteMany"]);
const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);
const RAW = new Set(["findRaw", "aggregateRaw", "runCommandRaw", "queryRaw", "executeRaw"]);

/** Matches no document: used when a tenant query has no tenant context. */
const NOTHING = { id: "__no_tenant_context__" };

export class TenantGuardError extends Error {}

type Where = Record<string, unknown> & { AND?: unknown };

/** Adds a filter while keeping unique keys at the top level (findUnique/update need them there). */
function narrow(where: Where | undefined, filter: Record<string, unknown>): Where {
  if (!where) return filter;
  const and = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...where, AND: [...and, filter] };
}

function readFilter(model: string, s: DbScope): Record<string, unknown> {
  if (model === "Tenant") {
    const or = [...(s.tenantId ? [{ id: s.tenantId }] : []), ...(s.userId ? [{ memberships: { some: { userId: s.userId } } }] : [])];
    return or.length ? { OR: or } : NOTHING;
  }
  if (model === "Membership") {
    const or = [...(s.tenantId ? [{ tenantId: s.tenantId }] : []), ...(s.userId ? [{ userId: s.userId }] : [])];
    return or.length ? { OR: or } : NOTHING;
  }
  return s.tenantId ? { tenantId: s.tenantId } : NOTHING;
}

function writeFilter(model: string, s: DbScope): Record<string, unknown> {
  if (!s.tenantId) return NOTHING;
  return model === "Tenant" ? { id: s.tenantId } : { tenantId: s.tenantId };
}

function assertOwnTenant(model: string, data: unknown, s: DbScope) {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows as Record<string, unknown>[]) {
    const value = model === "Tenant" ? row?.id : row?.tenantId;
    if (!s.tenantId || value !== s.tenantId) throw new TenantGuardError(`${model}: write outside the current tenant`);
  }
}

function assertTenantUnchanged(model: string, data: unknown, s: DbScope) {
  const value = (data as Record<string, unknown> | undefined)?.[model === "Tenant" ? "id" : "tenantId"];
  if (value !== undefined && value !== s.tenantId) throw new TenantGuardError(`${model}: tenant cannot be changed`);
}

export const tenantGuard: Prisma.Middleware = async (params, next) => {
  const s = dbScope.getStore() ?? {};
  const model = params.model;
  if (s.system || !model) return next(params);

  if (model === "PlatformExpense") throw new TenantGuardError("PlatformExpense is platform-only");
  if (model === "Plan" && !READS.has(params.action)) throw new TenantGuardError("Plans are read-only for tenants");
  if (!TENANT_MODELS.has(model) && model !== "Tenant") return next(params);
  if (RAW.has(params.action)) throw new TenantGuardError(`Raw ${params.action} on ${model} bypasses tenant isolation`);

  const args = (params.args ??= {}) as Record<string, unknown> & { where?: Where; data?: unknown; create?: unknown; update?: unknown };
  if (READS.has(params.action)) {
    args.where = narrow(args.where, readFilter(model, s));
  } else if (SCOPED_WRITES.has(params.action)) {
    args.where = narrow(args.where, writeFilter(model, s));
    assertTenantUnchanged(model, args.data, s);
  } else if (CREATES.has(params.action)) {
    assertOwnTenant(model, args.data, s);
  } else if (params.action === "upsert") {
    args.where = narrow(args.where, writeFilter(model, s));
    assertOwnTenant(model, args.create, s);
    assertTenantUnchanged(model, args.update, s);
  }
  return next(params);
};
