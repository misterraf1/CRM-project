import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { resolvePermissions, type Permission } from "@axis/shared";
import type { Request } from "express";
import { currentContext } from "../common/context";
import { ALLOW_INACTIVE, IS_PUBLIC, REQUIRED_FEATURE, REQUIRED_PERMISSION } from "../common/decorators";
import { AppError, forbidden } from "../common/errors";
import { EntitlementsService, INACTIVE_STATUSES } from "../billing/entitlements.service";
import { PrismaService } from "../prisma/prisma.service";
import { TokensService } from "./tokens.service";

/**
 * Global guard. Verifies the access token, then re-reads the session and membership
 * on every request so logout, disabling a member or a role change take effect
 * immediately instead of when the token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.get("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) throw new AppError("UNAUTHENTICATED", "Missing bearer token");

    const payload = await this.tokens.verifyAccess(token);
    const found = await this.prisma.scoped(
      async (tx) => {
        const session = await tx.session.findUnique({ where: { id: payload.sid } });
        if (!session || session.revokedAt || session.userId !== payload.sub || session.tenantId !== payload.tid) return null;
        const [membership, subscription] = await Promise.all([
          tx.membership.findFirst({ where: { tenantId: payload.tid, userId: payload.sub, status: "ACTIVE" } }),
          tx.subscription.findUnique({ where: { tenantId: payload.tid }, include: { plan: true } }),
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
    if (INACTIVE_STATUSES.has(subscription.status) && req.method !== "GET" && !this.reflector.getAllAndOverride<boolean>(ALLOW_INACTIVE, targets)) {
      throw new AppError("SUBSCRIPTION_INACTIVE", "The subscription is not active; the workspace is read-only", { status: subscription.status });
    }
    const feature = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_FEATURE, targets);
    if (feature && !features.includes(feature)) {
      throw new AppError("FEATURE_NOT_IN_PLAN", `The ${subscription.plan.code} plan does not include ${feature}`, { feature, plan: subscription.plan.code });
    }

    const required = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PERMISSION, targets);
    if (required && !permissions.includes(required)) throw forbidden(`Requires permission ${required}`);
    return true;
  }
}
