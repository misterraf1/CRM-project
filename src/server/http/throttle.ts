import { AppError } from "../common/errors";
import type { JwtService } from "../common/jwt";

const DEFAULT = { limit: 600, ttl: 60_000 };

/**
 * Fixed-window rate limits per route and caller, in memory (one instance; moves to
 * Redis with horizontal scaling). Signed-in traffic is keyed per user instead of per
 * IP: a whole office usually shares one public IP, so per-IP limits would throttle
 * colleagues against each other. The token signature is verified, so a forged token
 * can't escape the per-IP bucket. Anonymous calls (login, signup, widget) stay per IP.
 */
export class Throttler {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private sweptAt = Date.now();

  constructor(private readonly jwt: JwtService) {}

  check(routeId: string, req: Request, ip: string | undefined, rule: { limit: number | (() => number); ttl: number } = DEFAULT) {
    const now = Date.now();
    this.sweep(now);
    const key = `${routeId}|${this.tracker(req, ip)}`;
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + rule.ttl };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    const limit = typeof rule.limit === "function" ? rule.limit() : rule.limit;
    if (entry.count > limit) throw new AppError("RATE_LIMITED", "Too many requests");
  }

  private tracker(req: Request, ip: string | undefined) {
    const [scheme, token] = (req.headers.get("authorization") ?? "").split(" ");
    if (scheme === "Bearer" && token) {
      try {
        return `user:${this.jwt.verify<{ sub: string }>(token).sub}`;
      } catch {
        /* invalid or expired: fall back to the IP */
      }
    }
    return `ip:${ip}`;
  }

  /** Drops expired windows once a minute so the map doesn't grow without bound. */
  private sweep(now: number) {
    if (now - this.sweptAt < 60_000) return;
    this.sweptAt = now;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
