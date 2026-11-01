import { API_SCOPE_PATHS, resolvePermissions, type ApiKeyCreatedDto, type ApiKeyDto, type ApiScope } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService, INACTIVE_STATUSES, subscriptionOf } from "../billing/entitlements.service";
import { authedContext, currentContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { randomToken, sha256 } from "../common/ids";
import type { Database } from "../db/database";
import type { ApiKey } from "../db/models";
import type { RouteOptions } from "../http/router";
import { memberRefs } from "../crm/scope";

const PREFIX = "axk_";
/** lastUsedAt is refreshed at most this often (not a write on every call) */
const TOUCH_MS = 5 * 60_000;

/** "axk_<tenant>.<secret>": the tenant part finds the company without scanning every key */
export const isApiKey = (token: string) => token.startsWith(PREFIX);

/**
 * Keys for the public API. A key acts as the member who made it (their current rights
 * still apply — a disabled member's keys stop working) and only on the paths its
 * scopes open: customers, deals, tasks, products. Sign-in, settings, members and
 * billing are never reachable with a key.
 */
export class ApiKeysService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(): Promise<ApiKeyDto[]> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const keys = await tx.apiKey.find({ tenantId: ctx.tenantId, revokedAt: null }, { sort: { createdAt: -1 } });
      const refs = await memberRefs(tx, ctx.tenantId, keys.map((k) => k.createdById));
      return keys.map((k) => this.toDto(k, refs));
    });
  }

  async create(name: string, scopes: ApiScope[]): Promise<ApiKeyCreatedDto> {
    const ctx = authedContext();
    const key = `${PREFIX}${ctx.tenantId}.${randomToken(24)}`;
    return this.db.scoped(async (tx) => {
      if ((await tx.apiKey.count({ tenantId: ctx.tenantId, revokedAt: null })) >= 20) throw new AppError("CONFLICT", "At most 20 API keys");
      const row = await tx.apiKey.insertOne({ tenantId: ctx.tenantId, name, prefix: key.slice(0, PREFIX.length + 6), tokenHash: sha256(key), scopes: [...new Set(scopes)], createdById: ctx.membershipId });
      await this.audit.log(tx, { action: "api_key.created", entityType: "api_key", entityId: row.id, diff: { name, scopes } });
      return { key, apiKey: this.toDto(row, await memberRefs(tx, ctx.tenantId, [row.createdById])) };
    });
  }

  async revoke(id: string): Promise<ApiKeyDto[]> {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const res = await tx.apiKey.updateMany({ id, tenantId: ctx.tenantId, revokedAt: null }, { $set: { revokedAt: new Date() } });
      if (!res.count) throw notFound("API key");
      await this.audit.log(tx, { action: "api_key.revoked", entityType: "api_key", entityId: id });
    });
    return this.list();
  }

  /** The AuthGuard's path for `Authorization: Bearer axk_…`. Fills the request context like a session would. */
  async authenticate(req: Request, token: string, route: Pick<RouteOptions, "permission" | "feature" | "allowInactive">) {
    const tenantId = token.slice(PREFIX.length).split(".")[0] ?? "";
    if (!tenantId) throw new AppError("UNAUTHENTICATED", "Invalid API key");
    const path = new URL(req.url).pathname;
    const found = await this.db.read(
      async (tx) => {
        const key = await tx.apiKey.findOne({ tenantId, tokenHash: sha256(token), revokedAt: null });
        if (!key) return null;
        const membership = await tx.membership.findOne({ id: key.createdById, tenantId, status: "ACTIVE" });
        if (!membership) return null;
        const [role, subscription] = await Promise.all([membership.roleId ? tx.role.findOne({ id: membership.roleId, tenantId }) : null, subscriptionOf(tx, tenantId).catch(() => null)]);
        return subscription ? { key, membership, role, subscription } : null;
      },
      { tenantId },
    );
    if (!found) throw new AppError("UNAUTHENTICATED", "Invalid API key");
    const { key, membership, role, subscription } = found;

    // The key's scopes decide which paths it may use at all
    const area = Object.entries(API_SCOPE_PATHS).find(([, prefixes]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`)))?.[0];
    const needed = area && `${area}.${req.method === "GET" || req.method === "HEAD" ? "read" : "write"}`;
    if (!needed || !key.scopes.includes(needed)) throw forbidden(needed ? `The API key lacks the ${needed} scope` : "This endpoint is not available to API keys");

    const features = this.entitlements.features(subscription);
    const permissions = resolvePermissions(membership.role, membership.permissions, role?.permissions);
    Object.assign(currentContext(), {
      userId: membership.userId,
      tenantId,
      sessionId: `apikey:${key.id}`,
      membershipId: membership.id,
      departmentId: membership.departmentId,
      role: membership.role,
      permissions,
      features,
      subscriptionStatus: subscription.status,
    });
    if (INACTIVE_STATUSES.has(subscription.status) && req.method !== "GET" && !route.allowInactive) {
      throw new AppError("SUBSCRIPTION_INACTIVE", "The subscription is not active; the workspace is read-only", { status: subscription.status });
    }
    if (route.feature && !features.includes(route.feature)) {
      throw new AppError("FEATURE_NOT_IN_PLAN", `The ${subscription.plan.code} plan does not include ${route.feature}`, { feature: route.feature, plan: subscription.plan.code });
    }
    if (route.permission && !permissions.includes(route.permission)) throw forbidden(`Requires permission ${route.permission}`);

    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > TOUCH_MS) {
      await this.db.system.apiKey.updateMany({ id: key.id, tenantId }, { $set: { lastUsedAt: new Date() } });
    }
  }

  private toDto(k: ApiKey, refs: Map<string, { id: string; name: string }>): ApiKeyDto {
    const by = refs.get(k.createdById);
    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes as ApiScope[],
      createdBy: by ? { id: by.id, name: by.name } : null,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    };
  }
}
