import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ThrottlerGuard, type ThrottlerModuleOptions, type ThrottlerStorage } from "@nestjs/throttler";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

/**
 * Rate limits keyed per signed-in user instead of per IP: a whole office usually
 * shares one public IP, so per-IP limits would throttle colleagues against each
 * other. The token signature is verified, so a forged token can't be used to
 * escape the per-IP bucket. Anonymous calls (login, signup, widget) stay per IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(
    options: ThrottlerModuleOptions,
    storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
  ) {
    super(options, storage, reflector);
  }

  protected async getTracker(req: Request): Promise<string> {
    const [scheme, token] = (req.get("authorization") ?? "").split(" ");
    if (scheme === "Bearer" && token) {
      try {
        const { sub } = this.jwt.verify<{ sub: string }>(token);
        return `user:${sub}`;
      } catch {
        /* invalid or expired: fall back to the IP */
      }
    }
    return `ip:${req.ip}`;
  }
}
