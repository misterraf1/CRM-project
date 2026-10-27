import { JwtService } from "../common/jwt";
import type { AdminMe, AdminMfaChallenge, AdminTokens, MfaEnabledDto, MfaSetupDto, PlatformRole } from "@/shared";
import type { User } from "../db/models";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { verifyPassword } from "../auth/password";
import { config } from "../config";
import { currentContext } from "../common/context";
import { AppError } from "../common/errors";
import { sha256 } from "../common/ids";
import { openCredentials, sealCredentials } from "../common/secrets";
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from "../common/totp";
import type { Database } from "../db/database";

/** Admin tokens use their own issuer, so a tenant token can never pass as one (and vice versa). */
export const ADMIN_ISSUER = "axis-admin";
/** Proof that the password step passed; only good for the 2FA step, for 5 minutes. */
const MFA_ISSUER = "axis-admin-mfa";
const SESSION_HOURS = 8;
const RECOVERY_CODES = 10;

export interface AdminPayload {
  sub: string;
  sid: string;
}

const normaliseRecovery = (code: string) => code.replace(/[\s-]/g, "").toUpperCase();

export class AdminAuthService {
  constructor(
    private readonly db: Database,
    private readonly jwt: JwtService,
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
    if (!(await this.consumeCode(user, code, true))) {
      await this.audit(user.id, "platform.mfa_failed");
      throw new AppError("MFA_INVALID", "The code is not valid");
    }
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

  private secretOf(user: User) {
    return user.mfaSecret ? openCredentials(Buffer.from(user.mfaSecret, "base64")).totp! : null;
  }

  /**
   * Accepts an authenticator code (each 30-second code only once) or, when allowed,
   * a recovery code (each only once). Both are consumed with a conditional update, so
   * two parallel requests can't use the same code.
   */
  private async consumeCode(user: User, code: string, allowRecovery: boolean): Promise<boolean> {
    const secret = this.secretOf(user);
    const users = this.db.system.user;
    if (secret && /^\d{6}$/.test(code.replace(/\s/g, ""))) {
      const step = verifyTotp(secret, code);
      if (step === null) return false;
      const claimed = await users.updateMany({ id: user.id, $or: [{ mfaLastStep: null }, { mfaLastStep: { $lt: step } }] }, { $set: { mfaLastStep: step } });
      return claimed.count === 1;
    }
    if (!allowRecovery) return false;
    const hash = sha256(normaliseRecovery(code));
    if (!user.mfaRecoveryCodes.includes(hash)) return false;
    const claimed = await users.updateMany({ id: user.id, mfaRecoveryCodes: hash }, { $pull: { mfaRecoveryCodes: hash } });
    if (claimed.count === 1) await this.audit(user.id, "platform.mfa_recovery_used");
    return claimed.count === 1;
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

  /** Step 1: a new key (replaces an unconfirmed one). Nothing changes for sign-in yet. */
  async setupMfa(userId: string): Promise<MfaSetupDto> {
    const user = await this.user(userId);
    if (user.mfaEnabledAt) throw new AppError("CONFLICT", "2FA is already on");
    const secret = newTotpSecret();
    await this.db.system.user.update({ id: userId }, { $set: { mfaSecret: sealCredentials({ totp: secret }).toString("base64"), mfaLastStep: null } });
    const uri = otpauthUri(secret, user.email, "Axis Platform");
    return { secret, otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
  }

  /** Step 2: a code from the app proves it was set up; recovery codes are shown once. */
  async enableMfa(userId: string, code: string): Promise<MfaEnabledDto> {
    const user = await this.user(userId);
    if (user.mfaEnabledAt) throw new AppError("CONFLICT", "2FA is already on");
    if (!user.mfaSecret || !(await this.consumeCode(user, code, false))) throw new AppError("MFA_INVALID", "The code is not valid");
    const recoveryCodes = this.newRecoveryCodes();
    await this.db.system.user.update({ id: userId }, { $set: { mfaEnabledAt: new Date(), mfaRecoveryCodes: recoveryCodes.map((c) => sha256(normaliseRecovery(c))) } });
    await this.audit(userId, "platform.mfa_enabled");
    return { recoveryCodes };
  }

  async regenerateRecoveryCodes(userId: string, code: string): Promise<MfaEnabledDto> {
    const user = await this.user(userId);
    if (!user.mfaEnabledAt || !(await this.consumeCode(user, code, false))) throw new AppError("MFA_INVALID", "The code is not valid");
    const recoveryCodes = this.newRecoveryCodes();
    await this.db.system.user.update({ id: userId }, { $set: { mfaRecoveryCodes: recoveryCodes.map((c) => sha256(normaliseRecovery(c))) } });
    await this.audit(userId, "platform.mfa_recovery_regenerated");
    return { recoveryCodes };
  }

  /** Not allowed where 2FA is mandatory; otherwise needs a current code. */
  async disableMfa(userId: string, code: string) {
    if (config().PLATFORM_REQUIRE_MFA) throw new AppError("CONFLICT", "2FA is mandatory for platform staff");
    const user = await this.user(userId);
    if (!user.mfaEnabledAt || !(await this.consumeCode(user, code, false))) throw new AppError("MFA_INVALID", "The code is not valid");
    await this.db.system.user.update({ id: userId }, { $set: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [] } });
    await this.audit(userId, "platform.mfa_disabled");
  }

  private newRecoveryCodes() {
    return Array.from({ length: RECOVERY_CODES }, () => {
      const raw = base32Encode(randomBytes(5)); // 8 characters
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    });
  }
}
