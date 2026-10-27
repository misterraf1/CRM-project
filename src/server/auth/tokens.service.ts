import { JwtService } from "../common/jwt";
import type { AuthTokens } from "@/shared";
import { config } from "../config";
import { currentContext } from "../common/context";
import { AppError } from "../common/errors";
import { newId, randomToken, sha256 } from "../common/ids";
import type { Database, Tx } from "../db/database";

export interface AccessPayload {
  sub: string; // user id
  tid: string; // tenant id
  sid: string; // session id
}

/** Concurrent refreshes from the same client (parallel requests) within this window are not treated as theft. */
const REUSE_GRACE_MS = 30_000;

export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: Database,
  ) {}

  async issue(tx: Tx, userId: string, tenantId: string, familyId = newId("fam")): Promise<AuthTokens> {
    const { ACCESS_TOKEN_TTL_SEC, REFRESH_TOKEN_TTL_DAYS } = config();
    const ctx = currentContext();
    const refreshToken = randomToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const session = await tx.session.insertOne({
      userId,
      tenantId,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, tid: tenantId, sid: session.id } satisfies AccessPayload, {
      expiresIn: ACCESS_TOKEN_TTL_SEC,
    });
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SEC, refreshToken, refreshExpiresAt: expiresAt.toISOString() };
  }

  verifyAccess(token: string): Promise<AccessPayload> {
    return this.jwt.verifyAsync<AccessPayload>(token).catch(() => {
      throw new AppError("UNAUTHENTICATED", "Invalid or expired access token");
    });
  }

  /** Refresh-token rotation with reuse detection. */
  async rotate(refreshToken: string): Promise<AuthTokens> {
    const invalid = () => new AppError("UNAUTHENTICATED", "Invalid refresh token");
    const sessions = this.db.current.session;
    const session = await sessions.findOne({ tokenHash: sha256(refreshToken) });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw invalid();

    // Atomically claim the token; a second claimant sees count 0
    const claimed = await sessions.updateMany({ id: session.id, rotatedAt: null, revokedAt: null }, { $set: { rotatedAt: new Date() } });
    if (claimed.count === 0) {
      const current = await sessions.get({ id: session.id });
      const benignRace = current.rotatedAt && !current.revokedAt && Date.now() - current.rotatedAt.getTime() < REUSE_GRACE_MS;
      if (!benignRace) {
        await this.revokeFamily(session.familyId);
        throw invalid();
      }
    }

    return this.db.scoped(
      async (tx) => {
        const membership = await tx.membership.findOne({ tenantId: session.tenantId, userId: session.userId, status: "ACTIVE" });
        if (!membership) {
          await tx.session.updateMany({ familyId: session.familyId }, { $set: { revokedAt: new Date() } });
          throw invalid();
        }
        return this.issue(tx, session.userId, session.tenantId, session.familyId);
      },
      { tenantId: session.tenantId, userId: session.userId },
    );
  }

  async revokeFamily(familyId: string) {
    await this.db.current.session.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }

  async revokeByRefreshToken(refreshToken: string) {
    const session = await this.db.current.session.findOne({ tokenHash: sha256(refreshToken) });
    if (session) await this.revokeFamily(session.familyId);
  }

  async revokeSession(sessionId: string) {
    const session = await this.db.current.session.findOne({ id: sessionId });
    if (session) await this.revokeFamily(session.familyId);
  }
}
