import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { config } from "../config";
import { currentContext } from "../common/context";
import { AppError, forbidden } from "../common/errors";
import { AdminAuthService } from "./admin-auth.service";

const SUPER_ADMIN_ONLY = "axis:super-admin";
const WITHOUT_MFA = "axis:without-mfa";

/** Changes to prices, costs and company accounts: SUPER_ADMIN only (SUPPORT reads and answers tickets). */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY, true);

/** Reachable before 2FA is set up where it is mandatory (profile, 2FA setup, sign-out). */
export const AllowWithoutMfa = () => SetMetadata(WITHOUT_MFA, true);

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
    const { userId, role, sessionId, mfaEnabled } = await this.auth.resolve(await this.auth.verify(token));
    Object.assign(currentContext(), { userId, platformRole: role, adminSessionId: sessionId });

    const targets = [context.getHandler(), context.getClass()];
    if (config().PLATFORM_REQUIRE_MFA && !mfaEnabled && !this.reflector.getAllAndOverride<boolean>(WITHOUT_MFA, targets)) {
      throw new AppError("MFA_SETUP_REQUIRED", "Turn on two-factor authentication to use the platform console");
    }
    const superOnly = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY, targets);
    if (superOnly && role !== "SUPER_ADMIN") throw forbidden("Requires SUPER_ADMIN");
    return true;
  }
}
