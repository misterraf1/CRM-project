import { Controller, Get } from "@nestjs/common";
import type { AuditLogDto } from "@axis/shared";
import { authedContext } from "../common/context";
import { RequirePermission } from "../common/decorators";
import { PrismaService } from "../prisma/prisma.service";

@Controller("v1/audit-logs")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermission("audit.view")
  @Get()
  async list(): Promise<AuditLogDto[]> {
    const { tenantId } = authedContext();
    return this.prisma.scoped(async (tx) => {
      const logs = await tx.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 });
      const actorIds = [...new Set(logs.map((l) => l.actorId).filter((id): id is string => !!id))];
      const actors = await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } });
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
  }
}
