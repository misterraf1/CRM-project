import { currentContext } from "../common/context";
import type { Tx } from "../db/database";
import type { JsonValue } from "../db/models";

interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  diff?: JsonValue;
  /** Override when identity is established inside the same request (signup, invite) */
  tenantId?: string;
  actorId?: string;
}

export class AuditService {
  /** Writes inside the caller's transaction so the log and the change commit together. */
  async log(tx: Tx, entry: AuditEntry) {
    const ctx = currentContext();
    await tx.auditLog.insertOne({
      tenantId: entry.tenantId ?? ctx.tenantId ?? null,
      actorId: entry.actorId ?? ctx.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      diff: entry.diff ?? null,
      ip: ctx.ip ?? null,
    });
  }
}
