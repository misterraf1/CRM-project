import type { DepartmentDto, DepartmentInput } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import type { Database, Tx } from "../db/database";

export class DepartmentsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<DepartmentDto[]> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const [rows, counts] = await Promise.all([
        tx.department.find({ tenantId }, { sort: { name: 1 } }),
        this.memberCounts(tx, tenantId, { status: { $ne: "DISABLED" } }),
      ]);
      return rows.map((d) => ({ id: d.id, name: d.name, headId: d.headId, parentId: d.parentId, memberCount: counts.get(d.id) ?? 0 }));
    });
  }

  async create(input: DepartmentInput): Promise<DepartmentDto> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      await this.assertRefs(tx, tenantId, input);
      const d = await tx.department.insertOne({ tenantId, name: input.name, headId: input.headId ?? null, parentId: input.parentId ?? null });
      await this.audit.log(tx, { action: "department.created", entityType: "department", entityId: d.id, diff: { name: d.name } });
      return { id: d.id, name: d.name, headId: d.headId, parentId: d.parentId, memberCount: 0 };
    });
  }

  async update(id: string, input: DepartmentInput): Promise<DepartmentDto> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const current = await tx.department.findOne({ id, tenantId });
      if (!current) throw notFound("Department");
      if (input.parentId === id) throw new AppError("VALIDATION_FAILED", "A department cannot be its own parent");
      await this.assertRefs(tx, tenantId, input);
      const d = await tx.department.update({ id }, { $set: { name: input.name, headId: input.headId ?? null, parentId: input.parentId ?? null } });
      await this.audit.log(tx, { action: "department.updated", entityType: "department", entityId: id, diff: { name: d.name } });
      return { id: d.id, name: d.name, headId: d.headId, parentId: d.parentId, memberCount: await tx.membership.count({ tenantId, departmentId: id }) };
    });
  }

  async remove(id: string) {
    const { tenantId } = authedContext();
    await this.db.scoped(async (tx) => {
      const current = await tx.department.findOne({ id, tenantId });
      if (!current) throw notFound("Department");
      // Members and sub-departments are detached, never deleted
      await tx.membership.updateMany({ tenantId, departmentId: id }, { $set: { departmentId: null } });
      await tx.department.updateMany({ tenantId, parentId: id }, { $set: { parentId: null } });
      await tx.department.delete({ id });
      await this.audit.log(tx, { action: "department.deleted", entityType: "department", entityId: id, diff: { name: current.name } });
    });
  }

  private async assertRefs(tx: Tx, tenantId: string, input: DepartmentInput) {
    if (input.headId && !(await tx.membership.count({ id: input.headId, tenantId }))) {
      throw new AppError("VALIDATION_FAILED", "Unknown department head", { headId: ["Unknown member"] });
    }
    if (input.parentId && !(await tx.department.count({ id: input.parentId, tenantId }))) {
      throw new AppError("VALIDATION_FAILED", "Unknown parent department", { parentId: ["Unknown department"] });
    }
  }

  private async memberCounts(tx: Tx, tenantId: string, filter: Record<string, unknown>) {
    const rows = await tx.membership.aggregate<{ _id: string; n: number }>([
      { $match: { tenantId, departmentId: { $ne: null }, ...filter } },
      { $group: { _id: "$departmentId", n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [r._id, r.n]));
  }
}
