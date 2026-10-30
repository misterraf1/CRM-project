import { createHash } from "node:crypto";
import type { Database } from "../db/database";
import { isDuplicateKey } from "../db/errors";
import { keepAlive } from "./after-response";
import { currentContext } from "./context";
import { Logger } from "./logger";

const MAX_STACK = 4000;

/**
 * Records unexpected server errors (API 500s, failed job runs) in `ErrorEvent`, grouped
 * by fingerprint, for the platform System page. Works on serverless hosts, where logs
 * and in-memory state don't outlive the request. Never throws.
 */
export class ErrorReporter {
  private readonly logger = new Logger("ErrorReporter");
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly db: Database) {}

  capture(source: "api" | "job", error: unknown, where: string) {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = (err.message || err.name).slice(0, 500);
    const stack = err.stack?.slice(0, MAX_STACK) ?? null;
    // Same place + same first line = same problem; ids and numbers in messages vary
    const firstFrame = stack?.split("\n").find((l) => l.trim().startsWith("at ")) ?? "";
    const fingerprint = createHash("sha1")
      .update(`${source}|${where}|${message.replace(/[0-9a-f]{8,}|\d+/gi, "#")}|${firstFrame.trim()}`)
      .digest("hex");
    const tenantRef = currentContext().tenantId ?? null;
    const now = new Date();
    const record = () =>
      this.db.system.errorEvent.upsert(
        { fingerprint },
        { $inc: { count: 1 }, $set: { lastSeenAt: now, message, stack, where, tenantRef } },
        { fingerprint, source, message, stack, where, tenantRef, firstSeenAt: now },
      );
    // Written at once (nothing to wait for), kept alive past the response on serverless
    const write = record()
      // Two first occurrences at once: one insert wins, the other becomes an update
      .catch((e) => (isDuplicateKey(e) ? record() : Promise.reject(e)))
      .catch((e) => this.logger.warn(`Could not record error: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => this.pending.delete(write));
    this.pending.add(write);
    keepAlive(write);
  }

  /** Waits for writes in flight (before the database closes). */
  async flush() {
    await Promise.all(this.pending);
  }
}
