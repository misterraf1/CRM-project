import { Injectable } from "@nestjs/common";
import type { MemberProfileDto, MemberStatsDto } from "@axis/shared";
import { authedContext, type AuthedContext } from "../common/context";
import { notFound } from "../common/errors";
import { addDays, startOfDay } from "../common/time";
import { ActivityService, TIMELINE_ORDER } from "../crm/activity.service";
import { ownerScope } from "../crm/scope";
import { PrismaService, type Tx } from "../prisma/prisma.service";
import { TasksService } from "../tasks/tasks.service";

const DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
const OPEN_TASK = { status: { notIn: ["DONE", "CANCELED"] as ("DONE" | "CANCELED")[] } };

/**
 * Per-member performance. Owners/admins see everyone, managers their department,
 * employees only themselves (docs/ARCHITECTURE.md §6).
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly activity: ActivityService,
  ) {}

  async stats(period: keyof typeof DAYS): Promise<MemberStatsDto[]> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const { memberIds } = await ownerScope(tx, ctx, "dashboard.view_all");
      return this.compute(tx, ctx, period, memberIds);
    });
  }

  async profile(memberId: string): Promise<MemberProfileDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const { memberIds } = await ownerScope(tx, ctx, "dashboard.view_all");
      if (memberIds && !memberIds.includes(memberId)) throw notFound("Member");
      const [stats] = await this.compute(tx, ctx, "30d", [memberId]);
      if (!stats) throw notFound("Member");
      const m = await tx.membership.findUniqueOrThrow({ where: { id: memberId }, include: { department: { select: { name: true } } } });
      const [taskRows, activityRows] = await Promise.all([
        tx.task.findMany({
          where: { tenantId: ctx.tenantId, assigneeId: memberId, parentId: null, ...OPEN_TASK },
          include: { project: { select: { id: true, name: true } }, subtasks: { select: { status: true } }, _count: { select: { comments: true } } },
          orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
          take: 20,
        }),
        tx.activity.findMany({ where: { tenantId: ctx.tenantId, actorId: memberId }, orderBy: TIMELINE_ORDER, take: 20 }),
      ]);
      return {
        ...stats,
        joinedAt: m.joinedAt?.toISOString() ?? null,
        department: m.department?.name ?? null,
        tasks: await this.tasks.toDtos(tx, ctx, taskRows),
        activity: await this.activity.toDtos(tx, ctx.tenantId, activityRows),
      };
    });
  }

  private async compute(tx: Tx, ctx: AuthedContext, period: keyof typeof DAYS, memberIds: string[] | null): Promise<MemberStatsDto[]> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true } });
    const start = addDays(startOfDay(new Date(), tenant.timezone), -(DAYS[period] - 1), tenant.timezone);
    const now = new Date();
    const members = await tx.membership.findMany({
      where: { tenantId: ctx.tenantId, status: "ACTIVE", ...(memberIds ? { id: { in: memberIds } } : {}) },
      include: { user: { select: { fullName: true, email: true } } },
    });
    const ids = members.map((m) => m.id);
    const base = { tenantId: ctx.tenantId, parentId: null };
    const [open, overdue, done, won, openDeals] = await Promise.all([
      tx.task.groupBy({ by: ["assigneeId"], where: { ...base, ...OPEN_TASK, assigneeId: { in: ids } }, _count: true }),
      tx.task.groupBy({ by: ["assigneeId"], where: { ...base, ...OPEN_TASK, assigneeId: { in: ids }, dueAt: { lt: now } }, _count: true }),
      tx.task.groupBy({ by: ["assigneeId"], where: { ...base, status: "DONE", assigneeId: { in: ids }, completedAt: { gte: start } }, _count: true }),
      tx.deal.groupBy({
        by: ["ownerId"],
        where: { tenantId: ctx.tenantId, ownerId: { in: ids }, stage: { kind: "won" }, closedAt: { gte: start } },
        _count: true,
        _sum: { amount: true },
      }),
      tx.deal.groupBy({ by: ["ownerId"], where: { tenantId: ctx.tenantId, ownerId: { in: ids }, stage: { kind: "open" } }, _count: true }),
    ]);
    const count = (rows: { _count: number; assigneeId?: string | null; ownerId?: string | null }[], id: string) =>
      rows.find((r) => (r.assigneeId ?? r.ownerId) === id)?._count ?? 0;
    return members
      .map((m) => {
        const w = won.find((r) => r.ownerId === m.id);
        return {
          member: { id: m.id, name: m.user.fullName, title: m.title, role: m.role, departmentId: m.departmentId, email: m.user.email },
          openTasks: count(open, m.id),
          overdueTasks: count(overdue, m.id),
          tasksDone: count(done, m.id),
          dealsWon: w?._count ?? 0,
          revenue: w?._sum.amount ?? 0,
          openDeals: count(openDeals, m.id),
        };
      })
      .sort((a, b) => a.member.name.localeCompare(b.member.name));
  }
}
