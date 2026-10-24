import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { createNullFill } from "@axis/db/null-fill";
import { Prisma, PrismaClient } from "@prisma/client";
import { config } from "../config";
import { currentContext } from "../common/context";
import { dbScope, tenantGuard, type DbScope } from "./tenant-guard";

export type Tx = Prisma.TransactionClient;

const MAX_ATTEMPTS = 4;

/** MongoDB aborts one of two transactions that write the same document. */
const isWriteConflict = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ datasourceUrl: config().DATABASE_URL });
    // Every query — direct or inside a transaction — goes through the tenant guard,
    // then gets explicit nulls for omitted optional fields (see @axis/db/null-fill)
    this.$use(tenantGuard);
    this.$use(createNullFill(Prisma.dmmf));
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Runs `fn` in a transaction scoped to a tenant/user. Defaults to the current
   * request's identity; pass `scope` explicitly only for flows that establish
   * identity themselves (signup, login, invite acceptance, background jobs).
   * Write conflicts with concurrent transactions are retried.
   */
  async scoped<T>(fn: (tx: Tx) => Promise<T>, scope: Pick<DbScope, "tenantId" | "userId"> = currentContext()): Promise<T> {
    return this.transaction({ tenantId: scope.tenantId || undefined, userId: scope.userId || undefined }, fn);
  }

  /** `system()` inside one transaction: cross-tenant platform writes that must commit together. */
  systemTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.transaction({ system: true }, fn);
  }

  private async transaction<T>(s: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        // Prisma promises are lazy: they must be awaited inside the scope, or the
        // queries run without it (and the guard, failing closed, matches nothing)
        return await dbScope.run(s, async () => await this.$transaction(fn, { maxWait: 5_000, timeout: 10_000 }));
      } catch (e) {
        if (attempt >= MAX_ATTEMPTS || !isWriteConflict(e)) throw e;
        await new Promise((r) => setTimeout(r, 10 * attempt + Math.random() * 20));
      }
    }
  }

  /**
   * Cross-tenant platform operations (provider webhooks, background jobs, slug
   * availability). Bypasses the tenant guard — keep these narrow and id-only.
   */
  system<T>(fn: () => Promise<T>): Promise<T> {
    return dbScope.run({ system: true }, async () => await fn());
  }

  async ping() {
    await this.$runCommandRaw({ ping: 1 });
  }
}
