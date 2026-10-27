import type { ProjectDto, ProjectInput } from "@/shared";
import { authedContext } from "../common/context";
import { forbidden, notFound } from "../common/errors";
import type { Database } from "../db/database";

export class ProjectsService {
  constructor(private readonly db: Database) {}

  async list(): Promise<ProjectDto[]> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const [rows, open] = await Promise.all([
        tx.project.find({ tenantId }, { sort: { archived: 1, name: 1 } }),
        tx.task.aggregate<{ _id: string; n: number }>([
          { $match: { tenantId, projectId: { $ne: null }, status: { $nin: ["DONE", "CANCELED"] }, parentId: null } },
          { $group: { _id: "$projectId", n: { $sum: 1 } } },
        ]),
      ]);
      const counts = new Map(open.map((r) => [r._id, r.n]));
      return rows.map((p) => ({ id: p.id, name: p.name, archived: p.archived, openTasks: counts.get(p.id) ?? 0 }));
    });
  }

  async create(input: ProjectInput): Promise<ProjectDto> {
    const ctx = authedContext();
    const p = await this.db.scoped((tx) => tx.project.insertOne({ tenantId: ctx.tenantId, name: input.name, ownerId: ctx.membershipId }));
    return { id: p.id, name: p.name, archived: p.archived, openTasks: 0 };
  }

  /** Rename or archive: the project owner or a manager. */
  async update(id: string, input: Partial<ProjectInput>): Promise<ProjectDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const p = await tx.project.findOne({ id, tenantId: ctx.tenantId });
      if (!p) throw notFound("Project");
      if (p.ownerId !== ctx.membershipId && !ctx.permissions.includes("tasks.assign_any")) throw forbidden("Not allowed");
      const u = await tx.project.update({ id }, { $set: { name: input.name, archived: input.archived } });
      return { id: u.id, name: u.name, archived: u.archived, openTasks: 0 };
    });
  }
}
