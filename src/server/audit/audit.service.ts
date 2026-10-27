import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { currentContext } from "../common/context";
import type { Tx } from "../prisma/prisma.service";

interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  diff?: Prisma.InputJsonValue;
  /** Override when identity is established inside the same request (signup, invite) */
  tenantId?: string;
  actorId?: string;
}

@Injectable()
export class AuditService {
  /** Writes inside the caller's transaction so the log and the change commit together. */
  async log(tx: Tx, entry: AuditEntry) {
    const ctx = currentContext();
    await tx.auditLog.create({
      data: {
        tenantId: entry.tenantId ?? ctx.tenantId ?? null,
        actorId: entry.actorId ?? ctx.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        diff: entry.diff,
        ip: ctx.ip,
      },
    });
  }
}
