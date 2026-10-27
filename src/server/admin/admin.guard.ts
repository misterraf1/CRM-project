import { config } from "../config";
import { currentContext } from "../common/context";
import { AppError, forbidden } from "../common/errors";
import type { RouteOptions } from "../http/router";
import { AdminAuthService } from "./admin-auth.service";

/**
 * Guards /v1/admin/* routes marked `admin`. They skip the tenant AuthGuard; this
 * guard then requires a platform-staff token and session. No tenant is ever set,
 * so admin code reads across tenants only through db.system.
 */
export class AdminGuard {
  constructor(private readonly auth: AdminAuthService) {}

  /** `superAdminOnly`: prices, costs and company accounts (SUPPORT reads and answers tickets). */
  async check(req: Request, route: Pick<RouteOptions, "superAdminOnly" | "withoutMfa">): Promise<void> {
    const [scheme, token] = (req.headers.get("authorization") ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new AppError("UNAUTHENTICATED", "Missing bearer token");
    const { userId, role, sessionId, mfaEnabled } = await this.auth.resolve(await this.auth.verify(token));
    Object.assign(currentContext(), { userId, platformRole: role, adminSessionId: sessionId });

    if (config().PLATFORM_REQUIRE_MFA && !mfaEnabled && !route.withoutMfa) {
      throw new AppError("MFA_SETUP_REQUIRED", "Turn on two-factor authentication to use the platform console");
    }
    if (route.superAdminOnly && role !== "SUPER_ADMIN") throw forbidden("Requires SUPER_ADMIN");
  }
}
