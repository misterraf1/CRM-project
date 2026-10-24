import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { currentContext } from "../common/context";
import { AppError, forbidden } from "../common/errors";
import { AdminAuthService } from "./admin-auth.service";

const SUPER_ADMIN_ONLY = "axis:super-admin";

/** Changes to prices, costs and company accounts: SUPER_ADMIN only (SUPPORT reads and answers tickets). */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY, true);

/**
 * Guards /v1/admin/*. The controllers are @Public() for the tenant AuthGuard; this
 * guard then requires a platform-staff token and session. No tenant is ever set,
 * so admin code reads across tenants only through prisma.system().
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (req.get("authorization") ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new AppError("UNAUTHENTICATED", "Missing bearer token");
    const { userId, role, sessionId } = await this.auth.resolve(await this.auth.verify(token));
    Object.assign(currentContext(), { userId, platformRole: role, adminSessionId: sessionId });

    const superOnly = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY, [context.getHandler(), context.getClass()]);
    if (superOnly && role !== "SUPER_ADMIN") throw forbidden("Requires SUPER_ADMIN");
    return true;
  }
}
