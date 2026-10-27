import type { AuditLogDto } from "@/shared";
import { authedContext } from "../common/context";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function auditRoutes(router: Router, s: Services) {
  router.group("/v1/audit-logs", {}, (r) => {
    r.get("", { permission: "audit.view" }, (): Promise<AuditLogDto[]> => {
      const { tenantId } = authedContext();
      return s.db.scoped(async (tx) => {
        const logs = await tx.auditLog.find({ tenantId }, { sort: { createdAt: -1 }, limit: 100 });
        const actorIds = [...new Set(logs.map((l) => l.actorId).filter((id): id is string => !!id))];
        const actors = await tx.user.find({ id: { $in: actorIds } }, { projection: { id: 1, fullName: 1 } });
        const byId = new Map(actors.map((a) => [a.id, a]));
        return logs.map((l) => ({
          id: l.id,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          actor: (l.actorId && byId.get(l.actorId)) || null,
          diff: l.diff,
          createdAt: l.createdAt.toISOString(),
        }));
      });
    });
  });
}
