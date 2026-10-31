import { JwtService } from "../common/jwt";
import type { AdminMe, AdminMfaChallenge, AdminTokens, MfaEnabledDto, MfaSetupDto, PlatformRole } from "@/shared";
import { MfaService } from "../auth/mfa";
import { verifyPassword } from "../auth/password";
import { config } from "../config";
import { currentContext } from "../common/context";
import { AppError } from "../common/errors";
import type { Database } from "../db/database";

/** Admin tokens use their own issuer, so a tenant token can never pass as one (and vice versa). */
export const ADMIN_ISSUER = "axis-admin";
/** Proof that the password step passed; only good for the 2FA step, for 5 minutes. */
const MFA_ISSUER = "axis-admin-mfa";
const SESSION_HOURS = 8;

export interface AdminPayload {
  sub: string;
  sid: string;
}

export class AdminAuthService {
  constructor(
    private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly mfa: MfaService,
  ) {}

  private user(id: string) {
    return this.db.system.user.get({ id });
  }

  private audit(userId: string, action: string) {
    const ctx = currentContext();
    return this.db.system.auditLog.insertOne({ tenantId: null, actorId: userId, action, entityType: "user", entityId: userId, ip: ctx.ip ?? null });
  }

  /**
   * Platform staff only; everyone else gets the same answer as a wrong password.
   * With 2FA on, a correct password only yields a challenge for the code step.
   */
  async login(email: string, password: string): Promise<AdminTokens | AdminMfaChallenge> {
    const user = await this.db.system.user.findOne({ email });
    const ok = await verifyPassword(user?.passwordHash, password);
    if (!ok || !user || user.platformRole === "NONE") throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect");
    if (user.mfaEnabledAt) {
      const challenge = await this.jwt.signAsync({ sub: user.id }, { issuer: MFA_ISSUER, expiresIn: 300 });
      return { mfaRequired: true, challenge };
    }
    return this.issue(user.id);
  }

  async verifyMfa(challenge: string, code: string): Promise<AdminTokens> {
    const { sub } = await this.jwt.verifyAsync<{ sub: string }>(challenge, { issuer: MFA_ISSUER }).catch(() => {
      throw new AppError("UNAUTHENTICATED", "Sign-in step expired, enter the password again");
    });
    const user = await this.user(sub);
    if (user.platformRole === "NONE" || !user.mfaEnabledAt) throw new AppError("UNAUTHENTICATED", "Sign-in step expired, enter the password again");
    const used = await this.mfa.consume(user, code, true);
    if (!used) {
      await this.audit(user.id, "platform.mfa_failed");
      throw new AppError("MFA_INVALID", "The code is not valid");
    }
    if (used === "recovery") await this.audit(user.id, "platform.mfa_recovery_used");
    return this.issue(user.id);
  }

  private async issue(userId: string): Promise<AdminTokens> {
    const ctx = currentContext();
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
    const session = await this.db.systemTx(async (tx) => {
      const s = await tx.adminSession.insertOne({ userId, expiresAt, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null });
      await tx.auditLog.insertOne({ tenantId: null, actorId: userId, action: "platform.login", entityType: "user", entityId: userId, ip: ctx.ip ?? null });
      return s;
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: session.id } satisfies AdminPayload, {
      issuer: ADMIN_ISSUER,
      expiresIn: SESSION_HOURS * 3600,
    });
    return { accessToken, expiresAt: expiresAt.toISOString() };
  }

  verify(token: string): Promise<AdminPayload> {
    return this.jwt.verifyAsync<AdminPayload>(token, { issuer: ADMIN_ISSUER }).catch(() => {
      throw new AppError("UNAUTHENTICATED", "Invalid or expired admin token");
    });
  }

  /** Session + role re-read on every request: logout and role removal apply immediately. */
  async resolve(payload: AdminPayload): Promise<{ userId: string; role: PlatformRole; sessionId: string; mfaEnabled: boolean }> {
    const session = await this.db.system.adminSession.findOne({ id: payload.sid });
    const user = session && (await this.db.system.user.findOne({ id: session.userId }));
    if (!session || !user || session.revokedAt || session.expiresAt < new Date() || session.userId !== payload.sub || user.platformRole === "NONE") {
      throw new AppError("UNAUTHENTICATED", "Admin session is no longer valid");
    }
    return { userId: session.userId, role: user.platformRole, sessionId: session.id, mfaEnabled: !!user.mfaEnabledAt };
  }

  async logout(sessionId: string) {
    await this.db.system.adminSession.updateMany({ id: sessionId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }

  async me(userId: string): Promise<AdminMe> {
    const user = await this.user(userId);
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.platformRole as PlatformRole,
      mfaEnabled: !!user.mfaEnabledAt,
      mfaRequired: config().PLATFORM_REQUIRE_MFA,
      recoveryCodesLeft: user.mfaRecoveryCodes.length,
    };
  }

  async setupMfa(userId: string): Promise<MfaSetupDto> {
    return this.mfa.setup(await this.user(userId), "Axis Platform");
  }

  async enableMfa(userId: string, code: string): Promise<MfaEnabledDto> {
    const out = await this.mfa.enable(await this.user(userId), code);
    await this.audit(userId, "platform.mfa_enabled");
    return out;
  }

  async regenerateRecoveryCodes(userId: string, code: string): Promise<MfaEnabledDto> {
    const out = await this.mfa.regenerate(await this.user(userId), code);
    await this.audit(userId, "platform.mfa_recovery_regenerated");
    return out;
  }

  /** Not allowed where 2FA is mandatory; otherwise needs a current code. */
  async disableMfa(userId: string, code: string) {
    if (config().PLATFORM_REQUIRE_MFA) throw new AppError("CONFLICT", "2FA is mandatory for platform staff");
    await this.mfa.disable(await this.user(userId), code);
    await this.audit(userId, "platform.mfa_disabled");
  }
}
