import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma, Task } from "@prisma/client";
import type {
  CommentDto,
  TaskCreateInput,
  TaskDetailDto,
  TaskDto,
  TaskListQuery,
  TaskUpdateInput,
} from "@axis/shared";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { memberRefs, ownerScope } from "../crm/scope";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService, type Tx } from "../prisma/prisma.service";
import { detachFiles, FILE_STORAGE, type FileStorage } from "../storage/storage.service";

const OPEN: Prisma.TaskWhereInput = { status: { notIn: ["DONE", "CANCELED"] } };
const RECENT_DONE_DAYS = 14;
const POSITION_STEP = 1024;
const LIST_LIMIT = 500;

const INCLUDE = {
  project: { select: { id: true, name: true } },
  subtasks: { select: { status: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;

type TaskRow = Task & {
  project: { id: string; name: string } | null;
  subtasks: { status: string }[];
  _count: { comments: number };
};

/**
 * Who sees a task: holders of tasks.view_all see everything; managers see tasks
 * assigned to or created by their department; everyone else sees tasks assigned to
 * or created by themselves.
 */
export async function taskScope(tx: Tx, ctx: AuthedContext) {
  const s = await ownerScope(tx, ctx, "tasks.view_all");
  const where: Prisma.TaskWhereInput = s.memberIds
    ? { OR: [{ assigneeId: { in: s.memberIds } }, { creatorId: { in: s.memberIds } }] }
    : {};
  return { scope: s.scope, memberIds: s.memberIds, where };
}

/** Next occurrence for the supported RRULE subset (FREQ=DAILY|WEEKLY|MONTHLY;INTERVAL=n). */
export function nextOccurrence(rule: string, from: Date): Date {
  const freq = /FREQ=(DAILY|WEEKLY|MONTHLY)/.exec(rule)?.[1];
  const interval = Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? 1);
  const next = new Date(from);
  if (freq === "DAILY") next.setUTCDate(next.getUTCDate() + interval);
  else if (freq === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7 * interval);
  else next.setUTCMonth(next.getUTCMonth() + interval);
  return next;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger("Tasks");

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async list(query: TaskListQuery): Promise<TaskDto[]> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const { where: scoped } = await taskScope(tx, ctx);
      const now = new Date();
      const view: Prisma.TaskWhereInput =
        query.view === "mine"
          ? { assigneeId: ctx.membershipId }
          : query.view === "created"
            ? { creatorId: ctx.membershipId }
            : query.view === "overdue"
              ? { ...OPEN, dueAt: { lt: now, not: null } }
              : {};
      const done: Prisma.TaskWhereInput = query.status
        ? { status: query.status }
        : query.includeDone
          ? { OR: [OPEN, { completedAt: { gte: new Date(now.getTime() - RECENT_DONE_DAYS * 86_400_000) } }] }
          : OPEN;
      const q = query.q?.trim();
      const where: Prisma.TaskWhereInput = {
          AND: [
            { tenantId: ctx.tenantId, parentId: null },
            scoped,
            view,
            done,
            query.assigneeId ? { assigneeId: query.assigneeId === "none" ? null : query.assigneeId } : {},
            query.projectId ? { projectId: query.projectId } : {},
            query.contactId ? { contactId: query.contactId } : {},
            query.dealId ? { dealId: query.dealId } : {},
            q ? { title: { contains: q, mode: "insensitive" } } : {},
          ],
      };
      // Dated tasks first by due date, then undated ones (no NULLS LAST in MongoDB)
      const dated = await tx.task.findMany({ where: { AND: [where, { dueAt: { not: null } }] }, include: INCLUDE, orderBy: [{ dueAt: "asc" }, { position: "asc" }], take: LIST_LIMIT });
      const undated = await tx.task.findMany({ where: { AND: [where, { dueAt: null }] }, include: INCLUDE, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: LIST_LIMIT - dated.length });
      return this.toDtos(tx, ctx, [...dated, ...undated]);
    });
  }

  async get(id: string): Promise<TaskDetailDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const task = await this.findVisible(tx, ctx, id);
      const [subtasks, comments, files] = await Promise.all([
        tx.task.findMany({ where: { tenantId: ctx.tenantId, parentId: id }, include: INCLUDE, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
        tx.taskComment.findMany({ where: { tenantId: ctx.tenantId, taskId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        tx.fileObject.findMany({ where: { tenantId: ctx.tenantId, entityType: "task", entityId: id }, orderBy: { createdAt: "asc" } }),
      ]);
      const refs = await memberRefs(tx, ctx.tenantId, [...comments.map((c) => c.authorId), ...files.map((f) => f.uploaderId)]);
      const ref = (id: string) => {
        const r = refs.get(id);
        return r ? { id: r.id, name: r.name } : null;
      };
      const [dto, ...subDtos] = await this.toDtos(tx, ctx, [task, ...subtasks]);
      return {
        ...dto!,
        subtaskItems: subDtos,
        commentItems: comments.map((c): CommentDto => ({ id: c.id, author: ref(c.authorId), body: c.body, createdAt: c.createdAt.toISOString() })),
        fileItems: files.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          uploader: ref(f.uploaderId),
          createdAt: f.createdAt.toISOString(),
        })),
      };
    });
  }

  async create(input: TaskCreateInput): Promise<TaskDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      if (input.parentId) {
        const parent = await this.findVisible(tx, ctx, input.parentId);
        if (parent.parentId) throw new AppError("VALIDATION_FAILED", "Subtasks cannot be nested", { parentId: ["Nested subtask"] });
      }
      const assigneeId = input.assigneeId === undefined ? ctx.membershipId : input.assigneeId;
      await this.assertAssignable(tx, ctx, assigneeId);
      await this.assertLinks(tx, ctx, input);

      const last = await tx.task.aggregate({ where: { tenantId: ctx.tenantId, status: input.status }, _max: { position: true } });
      const task = await tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          title: input.title,
          description: input.description ?? null,
          status: input.status,
          priority: input.priority,
          creatorId: ctx.membershipId,
          assigneeId,
          dueAt: input.dueAt ?? null,
          projectId: input.projectId ?? null,
          parentId: input.parentId ?? null,
          contactId: input.contactId ?? null,
          dealId: input.dealId ?? null,
          recurrence: input.recurrence ?? null,
          completedAt: input.status === "DONE" ? new Date() : null,
          position: (last._max.position ?? 0) + POSITION_STEP,
        },
        include: INCLUDE,
      });
      await this.notifications.notify(
        tx,
        ctx.tenantId,
        [assigneeId],
        "task_assigned",
        { taskId: task.id, title: task.title, actorName: await this.actorName(tx, ctx) },
        ctx.membershipId,
      );
      return (await this.toDtos(tx, ctx, [task]))[0]!;
    });
  }

  async update(id: string, input: TaskUpdateInput): Promise<TaskDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const current = await this.findVisible(tx, ctx, id);
      const onlyStatus = Object.keys(input).every((k) => k === "status" || k === "position");
      // Anyone who sees a task may move it along; other fields need edit rights
      if (!onlyStatus && !this.canEdit(ctx, current)) throw forbidden("Only the creator, the assignee or a manager can edit this task");
      if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) await this.assertAssignable(tx, ctx, input.assigneeId);
      await this.assertLinks(tx, ctx, input);

      const finishing = input.status === "DONE" && current.status !== "DONE";
      const reopening = input.status !== undefined && input.status !== "DONE" && current.status === "DONE";
      const dueChanged = input.dueAt !== undefined && input.dueAt?.getTime() !== current.dueAt?.getTime();

      const task = await tx.task.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description,
          status: input.status,
          priority: input.priority,
          assigneeId: input.assigneeId,
          dueAt: input.dueAt,
          projectId: input.projectId,
          contactId: input.contactId,
          dealId: input.dealId,
          recurrence: input.recurrence,
          position: input.position,
          ...(finishing ? { completedAt: new Date() } : reopening ? { completedAt: null } : {}),
          ...(dueChanged ? { overdueNotifiedAt: null } : {}),
        },
        include: INCLUDE,
      });

      const actorName = await this.actorName(tx, ctx);
      if (input.assigneeId && input.assigneeId !== current.assigneeId) {
        await this.notifications.notify(tx, ctx.tenantId, [input.assigneeId], "task_assigned", { taskId: id, title: task.title, actorName }, ctx.membershipId);
      }
      if (finishing) {
        await this.notifications.notify(tx, ctx.tenantId, [task.creatorId], "task_completed", { taskId: id, title: task.title, actorName }, ctx.membershipId);
        if (task.recurrence) await this.spawnNext(tx, task);
      }
      return (await this.toDtos(tx, ctx, [task]))[0]!;
    });
  }

  async remove(id: string) {
    const ctx = authedContext();
    const keys = await this.prisma.scoped(async (tx) => {
      const task = await this.findVisible(tx, ctx, id);
      if (!this.canDelete(ctx, task)) throw forbidden("Only the creator or a manager can delete this task");
      const taskIds = [id, ...(await tx.task.findMany({ where: { tenantId: ctx.tenantId, parentId: id }, select: { id: true } })).map((t) => t.id)];
      const keys = await detachFiles(tx, ctx.tenantId, "task", taskIds);
      // Subtasks are removed explicitly (self-relations can't cascade on MongoDB); comments cascade
      await tx.task.deleteMany({ where: { tenantId: ctx.tenantId, parentId: id } });
      await tx.task.delete({ where: { id } });
      return keys;
    });
    // Blobs go after the commit; a failure leaves an orphan blob, never a dangling record
    for (const key of keys) await this.storage.remove(key).catch((e) => this.logger.warn(`Orphan blob ${key}: ${e}`));
  }

  async addComment(id: string, body: string): Promise<CommentDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const task = await this.findVisible(tx, ctx, id);
      const comment = await tx.taskComment.create({ data: { tenantId: ctx.tenantId, taskId: id, authorId: ctx.membershipId, body } });
      const actorName = await this.actorName(tx, ctx);
      await this.notifications.notify(
        tx,
        ctx.tenantId,
        [task.assigneeId, task.creatorId],
        "task_comment",
        { taskId: id, title: task.title, actorName, excerpt: body.slice(0, 140) },
        ctx.membershipId,
      );
      return { id: comment.id, author: { id: ctx.membershipId, name: actorName }, body, createdAt: comment.createdAt.toISOString() };
    });
  }

  /** Visible task or 404 — same response for "missing" and "not yours". */
  async findVisible(tx: Tx, ctx: AuthedContext, id: string): Promise<TaskRow> {
    const { where } = await taskScope(tx, ctx);
    const task = await tx.task.findFirst({ where: { AND: [{ id, tenantId: ctx.tenantId }, where] }, include: INCLUDE });
    if (task) return task;
    // Subtasks inherit visibility from a visible parent
    const sub = await tx.task.findFirst({ where: { id, tenantId: ctx.tenantId, parentId: { not: null } }, include: INCLUDE });
    if (sub?.parentId && (await tx.task.count({ where: { AND: [{ id: sub.parentId, tenantId: ctx.tenantId }, where] } }))) return sub;
    throw notFound("Task");
  }

  canEdit(ctx: AuthedContext, t: Pick<Task, "creatorId" | "assigneeId">) {
    return t.creatorId === ctx.membershipId || t.assigneeId === ctx.membershipId || ctx.permissions.includes("tasks.assign_any");
  }

  canDelete(ctx: AuthedContext, t: Pick<Task, "creatorId">) {
    return t.creatorId === ctx.membershipId || ctx.permissions.includes("tasks.assign_any");
  }

  /** Recurring task completed → next occurrence takes over the rule. */
  private async spawnNext(tx: Tx, task: Task) {
    const base = task.dueAt ?? new Date();
    await tx.task.create({
      data: {
        tenantId: task.tenantId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        creatorId: task.creatorId,
        assigneeId: task.assigneeId,
        projectId: task.projectId,
        contactId: task.contactId,
        dealId: task.dealId,
        recurrence: task.recurrence,
        dueAt: nextOccurrence(task.recurrence!, base),
        position: task.position,
      },
    });
    await tx.task.update({ where: { id: task.id }, data: { recurrence: null } });
  }

  /**
   * Assignment: yourself always; with tasks.assign_any anyone active; otherwise
   * colleagues from your own department.
   */
  private async assertAssignable(tx: Tx, ctx: AuthedContext, assigneeId: string | null | undefined) {
    if (!assigneeId || assigneeId === ctx.membershipId) return;
    const target = await tx.membership.findFirst({ where: { id: assigneeId, tenantId: ctx.tenantId, status: "ACTIVE" } });
    if (!target) throw new AppError("VALIDATION_FAILED", "Unknown assignee", { assigneeId: ["Unknown member"] });
    if (ctx.permissions.includes("tasks.assign_any")) return;
    if (!ctx.departmentId || target.departmentId !== ctx.departmentId) {
      throw forbidden("You can assign tasks only to yourself or colleagues in your department");
    }
  }

  private async assertLinks(tx: Tx, ctx: AuthedContext, input: { projectId?: string | null; contactId?: string | null; dealId?: string | null }) {
    const invalid = (field: string) => new AppError("VALIDATION_FAILED", `Unknown ${field}`, { [field]: ["Unknown"] });
    if (input.projectId && !(await tx.project.count({ where: { id: input.projectId, tenantId: ctx.tenantId } }))) throw invalid("projectId");
    if (input.contactId || input.dealId) {
      const { where } = await ownerScope(tx, ctx, "contacts.view_all");
      if (input.contactId && !(await tx.contact.count({ where: { AND: [{ id: input.contactId, tenantId: ctx.tenantId, deletedAt: null }, where] } }))) {
        throw invalid("contactId");
      }
      if (input.dealId && !(await tx.deal.count({ where: { AND: [{ id: input.dealId, tenantId: ctx.tenantId }, where] } }))) throw invalid("dealId");
    }
  }

  private async actorName(tx: Tx, ctx: AuthedContext) {
    return (await memberRefs(tx, ctx.tenantId, [ctx.membershipId])).get(ctx.membershipId)?.name ?? "";
  }

  async toDtos(tx: Tx, ctx: AuthedContext, rows: TaskRow[]): Promise<TaskDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [refs, contacts, deals, files] = await Promise.all([
      memberRefs(tx, ctx.tenantId, rows.flatMap((r) => [r.assigneeId, r.creatorId])),
      tx.contact.findMany({ where: { tenantId: ctx.tenantId, id: { in: rows.map((r) => r.contactId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      tx.deal.findMany({ where: { tenantId: ctx.tenantId, id: { in: rows.map((r) => r.dealId).filter((x): x is string => !!x) } }, select: { id: true, title: true } }),
      tx.fileObject.groupBy({ by: ["entityId"], where: { tenantId: ctx.tenantId, entityType: "task", entityId: { in: ids } }, _count: true }),
    ]);
    const contactById = new Map(contacts.map((c) => [c.id, c]));
    const dealById = new Map(deals.map((d) => [d.id, d]));
    const fileCount = new Map(files.map((f) => [f.entityId, f._count]));
    const ref = (id: string | null) => {
      const r = id ? refs.get(id) : undefined;
      return r ? { id: r.id, name: r.name } : null;
    };
    const now = Date.now();
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      assignee: ref(t.assigneeId),
      creator: ref(t.creatorId),
      dueAt: t.dueAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      overdue: !!t.dueAt && t.dueAt.getTime() < now && t.status !== "DONE" && t.status !== "CANCELED",
      recurrence: t.recurrence,
      project: t.project,
      parentId: t.parentId,
      contact: (t.contactId && contactById.get(t.contactId)) || null,
      deal: (t.dealId && dealById.get(t.dealId)) || null,
      subtasks: { done: t.subtasks.filter((s) => s.status === "DONE").length, total: t.subtasks.length },
      comments: t._count.comments,
      files: fileCount.get(t.id) ?? 0,
      position: t.position,
      createdAt: t.createdAt.toISOString(),
      can: { edit: this.canEdit(ctx, t), delete: this.canDelete(ctx, t) },
    }));
  }
}
