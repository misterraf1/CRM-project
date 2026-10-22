import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { config } from "../config";
import { currentContext } from "../common/context";

export type Tx = Prisma.TransactionClient;

interface DbScope {
  tenantId?: string;
  userId?: string;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ datasourceUrl: config().DATABASE_URL });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Runs `fn` in a transaction scoped to a tenant/user for Row Level Security.
   * Defaults to the current request's identity; pass `scope` explicitly only for
   * flows that establish identity themselves (signup, login, invite acceptance).
   * Tenant tables must be accessed through this method — the bare client sees no
   * tenant rows at all because RLS fails closed.
   */
  scoped<T>(fn: (tx: Tx) => Promise<T>, scope: DbScope = currentContext()): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${scope.tenantId ?? ""}, true), set_config('app.user_id', ${scope.userId ?? ""}, true)`;
      return fn(tx);
    });
  }
}
