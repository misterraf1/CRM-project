import { Injectable } from "@nestjs/common";
import { config } from "../config";
import { currentContext } from "../common/context";
import { AppError } from "../common/errors";
import { randomToken, sha256 } from "../common/ids";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { hashPassword } from "./password";

const VALID_MINUTES = 60;

/**
 * "Forgot password": an emailed one-time link (sha256 stored, 60 minutes). The answer
 * is the same whether the email exists or not, so the form can't be used to find
 * accounts. A reset signs the user out everywhere (company and platform sessions).
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async request(email: string) {
    const db = this.prisma;
    const user = await this.prisma.system(() => db.user.findUnique({ where: { email } }));
    // Invited people who never set a password accept their invitation instead
    if (!user?.passwordHash) return;
    const token = randomToken(32);
    await this.prisma.systemTx(async (tx) => {
      // Only the newest link works
      await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.passwordReset.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + VALID_MINUTES * 60_000), ip: currentContext().ip },
      });
      await this.mail.queue(tx, {
        to: user.email,
        locale: user.locale,
        template: "password_reset",
        vars: { link: `${config().WEB_ORIGIN}/reset-password/${token}`, minutes: VALID_MINUTES },
      });
    });
  }

  async reset(token: string, password: string) {
    const passwordHash = await hashPassword(password);
    await this.prisma.systemTx(async (tx) => {
      const row = await tx.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
      if (!row || row.usedAt || row.expiresAt < new Date()) throw new AppError("TOKEN_INVALID", "The link is invalid or has expired");
      const claimed = await tx.passwordReset.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!claimed.count) throw new AppError("TOKEN_INVALID", "The link is invalid or has expired");
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
      const now = new Date();
      await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.adminSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.auditLog.create({ data: { tenantId: null, actorId: row.userId, action: "auth.password_reset", entityType: "user", entityId: row.userId, ip: currentContext().ip } });
    });
  }
}
