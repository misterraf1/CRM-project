import { Injectable } from "@nestjs/common";
import type { DepartmentDto, DepartmentInput } from "@axis/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { PrismaService, type Tx } from "../prisma/prisma.service";

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<DepartmentDto[]> {
    const { tenantId } = authedContext();
    const rows = await this.prisma.scoped((tx) =>
      tx.department.findMany({
        where: { tenantId },
        include: { _count: { select: { members: { where: { status: { not: "DISABLED" } } } } } },
        orderBy: { name: "asc" },
      }),
    );
    return rows.map((d) => ({ id: d.id, name: d.name, headId: d.headId, parentId: d.parentId, memberCount: d._count.members }));
  }

  async create(input: DepartmentInput): Promise<DepartmentDto> {
    const { tenantId } = authedContext();
    return this.prisma.scoped(async (tx) => {
      await this.assertRefs(tx, tenantId, input);
      const d = await tx.department.create({
        data: { tenantId, name: input.name, headId: input.headId ?? null, parentId: input.parentId ?? null },
      });
      await this.audit.log(tx, { action: "department.created", entityType: "department", entityId: d.id, diff: { name: d.name } });
      return { id: d.id, name: d.name, headId: d.headId, parentId: d.parentId, memberCount: 0 };
    });
  }

  async update(id: string, input: DepartmentInput): Promise<DepartmentDto> {
    const { tenantId } = authedContext();
    return this.prisma.scoped(async (tx) => {
      const current = await tx.department.findFirst({ where: { id, tenantId } });
      if (!current) throw notFound("Department");
      if (input.parentId === id) throw new AppError("VALIDATION_FAILED", "A department cannot be its own parent");
      await this.assertRefs(tx, tenantId, input);
      const d = await tx.department.update({
        where: { id },
        data: { name: input.name, headId: input.headId ?? null, parentId: input.parentId ?? null },
        include: { _count: { select: { members: true } } },
      });
      await this.audit.log(tx, { action: "department.updated", entityType: "department", entityId: id, diff: { name: d.name } });
      return { id: d.id, name: d.name, headId: d.headId, parentId: d.parentId, memberCount: d._count.members };
    });
  }

  async remove(id: string) {
    const { tenantId } = authedContext();
    await this.prisma.scoped(async (tx) => {
      const current = await tx.department.findFirst({ where: { id, tenantId } });
      if (!current) throw notFound("Department");
      // Members and sub-departments are detached (FK ON DELETE SET NULL), never deleted
      await tx.department.delete({ where: { id } });
      await this.audit.log(tx, { action: "department.deleted", entityType: "department", entityId: id, diff: { name: current.name } });
    });
  }

  private async assertRefs(tx: Tx, tenantId: string, input: DepartmentInput) {
    if (input.headId && !(await tx.membership.count({ where: { id: input.headId, tenantId } }))) {
      throw new AppError("VALIDATION_FAILED", "Unknown department head", { headId: ["Unknown member"] });
    }
    if (input.parentId && !(await tx.department.count({ where: { id: input.parentId, tenantId } }))) {
      throw new AppError("VALIDATION_FAILED", "Unknown parent department", { parentId: ["Unknown department"] });
    }
  }
}
