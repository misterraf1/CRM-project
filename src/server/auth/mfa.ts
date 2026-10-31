import type { MfaEnabledDto, MfaSetupDto } from "@/shared";
import type { User } from "../db/models";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { AppError } from "../common/errors";
import { sha256 } from "../common/ids";
import { openCredentials, sealCredentials } from "../common/secrets";
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from "../common/totp";
import type { Database } from "../db/database";

const RECOVERY_CODES = 10;
const normaliseRecovery = (code: string) => code.replace(/[\s-]/g, "").toUpperCase();

/**
 * Two-factor authentication of one account (authenticator app + recovery codes).
 * The key belongs to the user, so platform staff and company members share it:
 * one app entry, whichever door they sign in through. Callers write their own audit.
 */
export class MfaService {
  constructor(private readonly db: Database) {}

  private secretOf(user: User) {
    return user.mfaSecret ? openCredentials(Buffer.from(user.mfaSecret, "base64")).totp! : null;
  }

  /**
   * Accepts an authenticator code (each 30-second code only once) or, when allowed,
   * a recovery code (each only once). Both are consumed with a conditional update, so
   * two parallel requests can't use the same code.
   */
  async consume(user: User, code: string, allowRecovery: boolean): Promise<"totp" | "recovery" | null> {
    const secret = this.secretOf(user);
    const users = this.db.system.user;
    if (secret && /^\d{6}$/.test(code.replace(/\s/g, ""))) {
      const step = verifyTotp(secret, code);
      if (step === null) return null;
      const claimed = await users.updateMany({ id: user.id, $or: [{ mfaLastStep: null }, { mfaLastStep: { $lt: step } }] }, { $set: { mfaLastStep: step } });
      return claimed.count === 1 ? "totp" : null;
    }
    if (!allowRecovery) return null;
    const hash = sha256(normaliseRecovery(code));
    if (!user.mfaRecoveryCodes.includes(hash)) return null;
    const claimed = await users.updateMany({ id: user.id, mfaRecoveryCodes: hash }, { $pull: { mfaRecoveryCodes: hash } });
    return claimed.count === 1 ? "recovery" : null;
  }

  /** Step 1: a new key (replaces an unconfirmed one). Nothing changes for sign-in yet. */
  async setup(user: User, issuer: string): Promise<MfaSetupDto> {
    if (user.mfaEnabledAt) throw new AppError("CONFLICT", "2FA is already on");
    const secret = newTotpSecret();
    await this.db.system.user.update({ id: user.id }, { $set: { mfaSecret: sealCredentials({ totp: secret }).toString("base64"), mfaLastStep: null } });
    const uri = otpauthUri(secret, user.email, issuer);
    return { secret, otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
  }

  /** Step 2: a code from the app proves it was set up; recovery codes are shown once. */
  async enable(user: User, code: string): Promise<MfaEnabledDto> {
    if (user.mfaEnabledAt) throw new AppError("CONFLICT", "2FA is already on");
    if (!user.mfaSecret || !(await this.consume(user, code, false))) throw new AppError("MFA_INVALID", "The code is not valid");
    const recoveryCodes = this.newRecoveryCodes();
    await this.db.system.user.update({ id: user.id }, { $set: { mfaEnabledAt: new Date(), mfaRecoveryCodes: recoveryCodes.map((c) => sha256(normaliseRecovery(c))) } });
    return { recoveryCodes };
  }

  async regenerate(user: User, code: string): Promise<MfaEnabledDto> {
    if (!user.mfaEnabledAt || !(await this.consume(user, code, false))) throw new AppError("MFA_INVALID", "The code is not valid");
    const recoveryCodes = this.newRecoveryCodes();
    await this.db.system.user.update({ id: user.id }, { $set: { mfaRecoveryCodes: recoveryCodes.map((c) => sha256(normaliseRecovery(c))) } });
    return { recoveryCodes };
  }

  async disable(user: User, code: string) {
    if (!user.mfaEnabledAt || !(await this.consume(user, code, false))) throw new AppError("MFA_INVALID", "The code is not valid");
    await this.db.system.user.update({ id: user.id }, { $set: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [] } });
  }

  private newRecoveryCodes() {
    return Array.from({ length: RECOVERY_CODES }, () => {
      const raw = base32Encode(randomBytes(5)); // 8 characters
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    });
  }
}
