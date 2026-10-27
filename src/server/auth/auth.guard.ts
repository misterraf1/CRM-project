import { resolvePermissions } from "@/shared";
import { currentContext } from "../common/context";
import { AppError, forbidden } from "../common/errors";
import type { RouteOptions } from "../http/router";
import { EntitlementsService, INACTIVE_STATUSES, subscriptionOf } from "../billing/entitlements.service";
import type { Database } from "../db/database";
import { TokensService } from "./tokens.service";

/**
 * Runs for every non-public route. Verifies the access token, then re-reads the session and membership
 * on every request so logout, disabling a member or a role change take effect
 * immediately instead of when the token expires.
 */
export class AuthGuard {
  constructor(
    private readonly tokens: TokensService,
    private readonly db: Database,
    private readonly entitlements: EntitlementsService,
  ) {}

  async check(req: Request, route: Pick<RouteOptions, "permission" | "feature" | "allowInactive">): Promise<void> {
    const header = req.headers.get("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) throw new AppError("UNAUTHENTICATED", "Missing bearer token");

    const payload = await this.tokens.verifyAccess(token);
    const found = await this.db.scoped(
      async (tx) => {
        const session = await tx.session.findOne({ id: payload.sid });
        if (!session || session.revokedAt || session.userId !== payload.sub || session.tenantId !== payload.tid) return null;
        const [membership, subscription] = await Promise.all([
          tx.membership.findOne({ tenantId: payload.tid, userId: payload.sub, status: "ACTIVE" }),
          subscriptionOf(tx, payload.tid).catch(() => null),
        ]);
        return membership && subscription ? { membership, subscription } : null;
      },
      { tenantId: payload.tid, userId: payload.sub },
    );
    if (!found) throw new AppError("UNAUTHENTICATED", "Session is no longer valid");
    const { membership, subscription } = found;
    const features = this.entitlements.features(subscription);

    const permissions = resolvePermissions(membership.role, membership.permissions);
    Object.assign(currentContext(), {
      userId: payload.sub,
      tenantId: payload.tid,
      sessionId: payload.sid,
      membershipId: membership.id,
      departmentId: membership.departmentId,
      role: membership.role,
      permissions,
      features,
      subscriptionStatus: subscription.status,
    });

    // Suspended / canceled workspaces are read-only until paid
    if (INACTIVE_STATUSES.has(subscription.status) && req.method !== "GET" && !route.allowInactive) {
      throw new AppError("SUBSCRIPTION_INACTIVE", "The subscription is not active; the workspace is read-only", { status: subscription.status });
    }
    const feature = route.feature;
    if (feature && !features.includes(feature)) {
      throw new AppError("FEATURE_NOT_IN_PLAN", `The ${subscription.plan.code} plan does not include ${feature}`, { feature, plan: subscription.plan.code });
    }

    const required = route.permission;
    if (required && !permissions.includes(required)) throw forbidden(`Requires permission ${required}`);
  }
}
