import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { resolvePermissions, type Permission } from "@axis/shared";
import type { Request } from "express";
import { currentContext } from "../common/context";
import { IS_PUBLIC, REQUIRED_PERMISSION } from "../common/decorators";
import { AppError, forbidden } from "../common/errors";
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const header = context.switchToHttp().getRequest<Request>().get("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) throw new AppError("UNAUTHENTICATED", "Missing bearer token");

    const payload = await this.tokens.verifyAccess(token);
    const membership = await this.prisma.scoped(
      async (tx) => {
        const session = await tx.session.findUnique({ where: { id: payload.sid } });
        if (!session || session.revokedAt || session.userId !== payload.sub || session.tenantId !== payload.tid) return null;
        return tx.membership.findFirst({ where: { tenantId: payload.tid, userId: payload.sub, status: "ACTIVE" } });
      },
      { tenantId: payload.tid, userId: payload.sub },
    );
    if (!membership) throw new AppError("UNAUTHENTICATED", "Session is no longer valid");

    const permissions = resolvePermissions(membership.role, membership.permissions);
    Object.assign(currentContext(), {
      userId: payload.sub,
      tenantId: payload.tid,
      sessionId: payload.sid,
      membershipId: membership.id,
      departmentId: membership.departmentId,
      role: membership.role,
      permissions,
    });

    const required = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PERMISSION, targets);
    if (required && !permissions.includes(required)) throw forbidden(`Requires permission ${required}`);
    return true;
  }
}
