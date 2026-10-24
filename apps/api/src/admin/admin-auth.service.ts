import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AdminMe, AdminTokens, PlatformRole } from "@axis/shared";
import { verifyPassword } from "../auth/password";
import { currentContext } from "../common/context";
import { AppError } from "../common/errors";
import { PrismaService } from "../prisma/prisma.service";

/** Admin tokens use their own issuer, so a tenant token can never pass as one (and vice versa). */
export const ADMIN_ISSUER = "axis-admin";
const SESSION_HOURS = 8;

export interface AdminPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Platform staff only; everyone else gets the same answer as a wrong password. */
  async login(email: string, password: string): Promise<AdminTokens> {
    const user = await this.prisma.system(() => this.prisma.user.findUnique({ where: { email } }));
    const ok = await verifyPassword(user?.passwordHash, password);
    if (!ok || !user || user.platformRole === "NONE") throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect");

    const ctx = currentContext();
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
    const session = await this.prisma.systemTx(async (tx) => {
      const s = await tx.adminSession.create({ data: { userId: user.id, expiresAt, ip: ctx.ip, userAgent: ctx.userAgent } });
      await tx.auditLog.create({ data: { tenantId: null, actorId: user.id, action: "platform.login", entityType: "user", entityId: user.id, ip: ctx.ip } });
      return s;
    });
    const accessToken = await this.jwt.signAsync({ sub: user.id, sid: session.id } satisfies AdminPayload, {
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
  async resolve(payload: AdminPayload): Promise<{ userId: string; role: PlatformRole; sessionId: string }> {
    const session = await this.prisma.system(() => this.prisma.adminSession.findUnique({ where: { id: payload.sid }, include: { user: true } }));
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== payload.sub || session.user.platformRole === "NONE") {
      throw new AppError("UNAUTHENTICATED", "Admin session is no longer valid");
    }
    return { userId: session.userId, role: session.user.platformRole, sessionId: session.id };
  }

  async logout(sessionId: string) {
    await this.prisma.system(() => this.prisma.adminSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } }));
  }

  async me(userId: string): Promise<AdminMe> {
    const user = await this.prisma.system(() => this.prisma.user.findUniqueOrThrow({ where: { id: userId } }));
    return { id: user.id, fullName: user.fullName, email: user.email, role: user.platformRole as PlatformRole };
  }
}
