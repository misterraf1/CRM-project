import type { MemberProfileDto, MemberStatsDto } from "@/shared";
import { authedContext, type AuthedContext } from "../common/context";
import { notFound } from "../common/errors";
import { sortNullsLast } from "../common/sort";
import { addDays, startOfDay } from "../common/time";
import { ActivityService, TIMELINE_ORDER } from "../crm/activity.service";
import { stageIds } from "../crm/deals.service";
import { ownerScope } from "../crm/scope";
import type { Database, Tx } from "../db/database";
import { countBy } from "../db/query";
import { TasksService } from "../tasks/tasks.service";

const DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
const OPEN_TASK = { status: { $nin: ["DONE", "CANCELED"] } };

/**
 * Per-member performance. Owners/admins see everyone, managers their department,
 * employees only themselves (docs/ARCHITECTURE.md §6).
 */
export class TeamService {
  constructor(
    private readonly db: Database,
    private readonly tasks: TasksService,
    private readonly activity: ActivityService,
  ) {}

  async stats(period: keyof typeof DAYS): Promise<MemberStatsDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const { memberIds } = await ownerScope(tx, ctx, "dashboard.view_all");
      return this.compute(tx, ctx, period, memberIds);
    });
  }

  async profile(memberId: string): Promise<MemberProfileDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const { memberIds } = await ownerScope(tx, ctx, "dashboard.view_all");
      if (memberIds && !memberIds.includes(memberId)) throw notFound("Member");
      const [stats] = await this.compute(tx, ctx, "30d", [memberId]);
      if (!stats) throw notFound("Member");
      const m = await tx.membership.get({ id: memberId, tenantId: ctx.tenantId });
      const [department, taskRows, activityRows] = await Promise.all([
        m.departmentId ? tx.department.findOne({ id: m.departmentId }, { projection: { name: 1 } }) : null,
        tx.task.find({ tenantId: ctx.tenantId, assigneeId: memberId, parentId: null, ...OPEN_TASK }, { sort: { dueAt: 1, createdAt: 1 }, limit: 100 }),
        tx.activity.find({ tenantId: ctx.tenantId, actorId: memberId }, { sort: TIMELINE_ORDER, limit: 20 }),
      ]);
      return {
        ...stats,
        joinedAt: m.joinedAt?.toISOString() ?? null,
        department: department?.name ?? null,
        tasks: await this.tasks.toDtos(tx, ctx, sortNullsLast(taskRows, [(t) => t.dueAt, "asc"], [(t) => t.createdAt, "asc"]).slice(0, 20)),
        activity: await this.activity.toDtos(tx, ctx.tenantId, activityRows),
      };
    });
  }

  private async compute(tx: Tx, ctx: AuthedContext, period: keyof typeof DAYS, memberIds: string[] | null): Promise<MemberStatsDto[]> {
    const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { timezone: 1 } });
    const start = addDays(startOfDay(new Date(), tenant.timezone), -(DAYS[period] - 1), tenant.timezone);
    const now = new Date();
    const members = await tx.membership.find({ tenantId: ctx.tenantId, status: "ACTIVE", ...(memberIds ? { id: { $in: memberIds } } : {}) });
    const users = new Map((await tx.user.find({ id: { $in: members.map((m) => m.userId) } }, { projection: { id: 1, fullName: 1, email: 1 } })).map((u) => [u.id, u]));
    const ids = members.map((m) => m.id);
    const base = { tenantId: ctx.tenantId, parentId: null };
    const [openStages, wonStages] = await Promise.all([stageIds(tx, ctx.tenantId, "open"), stageIds(tx, ctx.tenantId, "won")]);
    const [open, overdue, done, won, openDeals] = await Promise.all([
      countBy(tx.task, "assigneeId", { ...base, ...OPEN_TASK, assigneeId: { $in: ids } }),
      countBy(tx.task, "assigneeId", { ...base, ...OPEN_TASK, assigneeId: { $in: ids }, dueAt: { $lt: now, $ne: null } }),
      countBy(tx.task, "assigneeId", { ...base, status: "DONE", assigneeId: { $in: ids }, completedAt: { $gte: start } }),
      countBy(tx.deal, "ownerId", { tenantId: ctx.tenantId, ownerId: { $in: ids }, stageId: { $in: wonStages }, closedAt: { $gte: start } }, "baseAmount"),
      countBy(tx.deal, "ownerId", { tenantId: ctx.tenantId, ownerId: { $in: ids }, stageId: { $in: openStages } }),
    ]);
    const count = (rows: Map<string, { count: number }>, id: string) => rows.get(id)?.count ?? 0;
    return members
      .map((m) => {
        const w = won.get(m.id);
        const user = users.get(m.userId);
        return {
          member: { id: m.id, name: user?.fullName ?? "", title: m.title, role: m.role, departmentId: m.departmentId, email: user?.email ?? "" },
          openTasks: count(open, m.id),
          overdueTasks: count(overdue, m.id),
          tasksDone: count(done, m.id),
          dealsWon: w?.count ?? 0,
          revenue: w?.sum ?? 0,
          openDeals: count(openDeals, m.id),
        };
      })
      .sort((a, b) => a.member.name.localeCompare(b.member.name));
  }
}
