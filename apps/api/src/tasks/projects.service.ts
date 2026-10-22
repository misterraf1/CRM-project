import { Injectable } from "@nestjs/common";
import type { ProjectDto, ProjectInput } from "@axis/shared";
import { authedContext } from "../common/context";
import { forbidden, notFound } from "../common/errors";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ProjectDto[]> {
    const { tenantId } = authedContext();
    const rows = await this.prisma.scoped((tx) =>
      tx.project.findMany({
        where: { tenantId },
        include: { _count: { select: { tasks: { where: { status: { notIn: ["DONE", "CANCELED"] }, parentId: null } } } } },
        orderBy: [{ archived: "asc" }, { name: "asc" }],
      }),
    );
    return rows.map((p) => ({ id: p.id, name: p.name, archived: p.archived, openTasks: p._count.tasks }));
  }

  async create(input: ProjectInput): Promise<ProjectDto> {
    const ctx = authedContext();
    const p = await this.prisma.scoped((tx) => tx.project.create({ data: { tenantId: ctx.tenantId, name: input.name, ownerId: ctx.membershipId } }));
    return { id: p.id, name: p.name, archived: p.archived, openTasks: 0 };
  }

  /** Rename or archive: the project owner or a manager. */
  async update(id: string, input: Partial<ProjectInput>): Promise<ProjectDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const p = await tx.project.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!p) throw notFound("Project");
      if (p.ownerId !== ctx.membershipId && !ctx.permissions.includes("tasks.assign_any")) throw forbidden("Not allowed");
      const u = await tx.project.update({ where: { id }, data: { name: input.name, archived: input.archived } });
      return { id: u.id, name: u.name, archived: u.archived, openTasks: 0 };
    });
  }
}
