import { Logger } from "../common/logger";
import type { Task } from "../db/models";
import type {
  CommentDto,
  TaskCreateInput,
  TaskDetailDto,
  TaskDto,
  TaskListQuery,
  TaskUpdateInput,
} from "@/shared";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { memberRefs, ownerScope } from "../crm/scope";
import { NotificationsService } from "../notifications/notifications.service";
import type { Database, Tx } from "../db/database";
import { and, contains, countBy } from "../db/query";
import type { Filter } from "../db/repo";
import { detachFiles, type FileStorage } from "../storage/storage.service";

const OPEN: Filter = { status: { $nin: ["DONE", "CANCELED"] } };
const RECENT_DONE_DAYS = 14;
const POSITION_STEP = 1024;
const LIST_LIMIT = 500;


/**
 * Who sees a task: holders of tasks.view_all see everything; managers see tasks
 * assigned to or created by their department; everyone else sees tasks assigned to
 * or created by themselves.
 */
export async function taskScope(tx: Tx, ctx: AuthedContext) {
  const s = await ownerScope(tx, ctx, "tasks.view_all");
  const where: Filter = s.memberIds ? { $or: [{ assigneeId: { $in: s.memberIds } }, { creatorId: { $in: s.memberIds } }] } : {};
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

export class TasksService {
  private readonly logger = new Logger("Tasks");

  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationsService,
    private readonly storage: FileStorage,
  ) {}

  async list(query: TaskListQuery): Promise<TaskDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const { where: scoped } = await taskScope(tx, ctx);
      const now = new Date();
      const view: Filter =
        query.view === "mine"
          ? { assigneeId: ctx.membershipId }
          : query.view === "created"
            ? { creatorId: ctx.membershipId }
            : query.view === "overdue"
              ? { ...OPEN, dueAt: { $lt: now, $ne: null } }
              : {};
      const done: Filter = query.status
        ? { status: query.status }
        : query.includeDone
          ? { $or: [OPEN, { completedAt: { $gte: new Date(now.getTime() - RECENT_DONE_DAYS * 86_400_000) } }] }
          : OPEN;
      const q = query.q?.trim();
      const where = and(
        { tenantId: ctx.tenantId, parentId: null },
        scoped,
        view,
        done,
        query.assigneeId ? { assigneeId: query.assigneeId === "none" ? null : query.assigneeId } : {},
        query.projectId ? { projectId: query.projectId } : {},
        query.contactId ? { contactId: query.contactId } : {},
        query.dealId ? { dealId: query.dealId } : {},
        q ? { title: contains(q) } : {},
      );
      // Dated tasks first by due date, then undated ones (MongoDB sorts nulls first)
      const [dated, undated] = await Promise.all([
        tx.task.find(and(where, { dueAt: { $ne: null } }), { sort: { dueAt: 1, position: 1 }, limit: LIST_LIMIT }),
        tx.task.find(and(where, { dueAt: null }), { sort: { position: 1, createdAt: 1 }, limit: LIST_LIMIT }),
      ]);
      return this.toDtos(tx, ctx, [...dated, ...undated].slice(0, LIST_LIMIT));
    });
  }

  async get(id: string): Promise<TaskDetailDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const task = await this.findVisible(tx, ctx, id);
      const [subtasks, comments, files] = await Promise.all([
        tx.task.find({ tenantId: ctx.tenantId, parentId: id }, { sort: { position: 1, createdAt: 1 } }),
        tx.taskComment.find({ tenantId: ctx.tenantId, taskId: id }, { sort: { createdAt: 1, id: 1 } }),
        tx.fileObject.find({ tenantId: ctx.tenantId, entityType: "task", entityId: id }, { sort: { createdAt: 1 } }),
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
    return this.db.scoped(async (tx) => {
      if (input.parentId) {
        const parent = await this.findVisible(tx, ctx, input.parentId);
        if (parent.parentId) throw new AppError("VALIDATION_FAILED", "Subtasks cannot be nested", { parentId: ["Nested subtask"] });
      }
      const assigneeId = input.assigneeId === undefined ? ctx.membershipId : input.assigneeId;
      await this.assertAssignable(tx, ctx, assigneeId);
      await this.assertLinks(tx, ctx, input);

      const last = await tx.task.findOne({ tenantId: ctx.tenantId, status: input.status }, { sort: { position: -1 }, projection: { position: 1 } });
      const task = await tx.task.insertOne({
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
          position: (last?.position ?? 0) + POSITION_STEP,
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
    return this.db.scoped(async (tx) => {
      const current = await this.findVisible(tx, ctx, id);
      const onlyStatus = Object.keys(input).every((k) => k === "status" || k === "position");
      // Anyone who sees a task may move it along; other fields need edit rights
      if (!onlyStatus && !this.canEdit(ctx, current)) throw forbidden("Only the creator, the assignee or a manager can edit this task");
      if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) await this.assertAssignable(tx, ctx, input.assigneeId);
      await this.assertLinks(tx, ctx, input);

      const finishing = input.status === "DONE" && current.status !== "DONE";
      const reopening = input.status !== undefined && input.status !== "DONE" && current.status === "DONE";
      const dueChanged = input.dueAt !== undefined && input.dueAt?.getTime() !== current.dueAt?.getTime();

      const task = await tx.task.update(
        { id },
        {
          $set: {
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
        },
      );

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
    const keys = await this.db.scoped(async (tx) => {
      const task = await this.findVisible(tx, ctx, id);
      if (!this.canDelete(ctx, task)) throw forbidden("Only the creator or a manager can delete this task");
      const taskIds = [id, ...(await tx.task.find({ tenantId: ctx.tenantId, parentId: id }, { projection: { id: 1 } })).map((t) => t.id)];
      const keys = await detachFiles(tx, ctx.tenantId, "task", taskIds);
      // Subtasks and comments go with the task
      await tx.taskComment.deleteMany({ tenantId: ctx.tenantId, taskId: { $in: taskIds } });
      await tx.task.deleteMany({ tenantId: ctx.tenantId, parentId: id });
      await tx.task.delete({ id });
      return keys;
    });
    // Blobs go after the commit; a failure leaves an orphan blob, never a dangling record
    for (const key of keys) await this.storage.remove(key).catch((e) => this.logger.warn(`Orphan blob ${key}: ${e}`));
  }

  async addComment(id: string, body: string): Promise<CommentDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const task = await this.findVisible(tx, ctx, id);
      const comment = await tx.taskComment.insertOne({ tenantId: ctx.tenantId, taskId: id, authorId: ctx.membershipId, body });
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
  async findVisible(tx: Tx, ctx: AuthedContext, id: string): Promise<Task> {
    const { where } = await taskScope(tx, ctx);
    const task = await tx.task.findOne(and({ id, tenantId: ctx.tenantId }, where));
    if (task) return task;
    // Subtasks inherit visibility from a visible parent
    const sub = await tx.task.findOne({ id, tenantId: ctx.tenantId, parentId: { $ne: null } });
    if (sub?.parentId && (await tx.task.count(and({ id: sub.parentId, tenantId: ctx.tenantId }, where)))) return sub;
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
    await tx.task.insertOne({
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
    });
    await tx.task.update({ id: task.id }, { $set: { recurrence: null } });
  }

  /**
   * Assignment: yourself always; with tasks.assign_any anyone active; otherwise
   * colleagues from your own department.
   */
  private async assertAssignable(tx: Tx, ctx: AuthedContext, assigneeId: string | null | undefined) {
    if (!assigneeId || assigneeId === ctx.membershipId) return;
    const target = await tx.membership.findOne({ id: assigneeId, tenantId: ctx.tenantId, status: "ACTIVE" });
    if (!target) throw new AppError("VALIDATION_FAILED", "Unknown assignee", { assigneeId: ["Unknown member"] });
    if (ctx.permissions.includes("tasks.assign_any")) return;
    if (!ctx.departmentId || target.departmentId !== ctx.departmentId) {
      throw forbidden("You can assign tasks only to yourself or colleagues in your department");
    }
  }

  private async assertLinks(tx: Tx, ctx: AuthedContext, input: { projectId?: string | null; contactId?: string | null; dealId?: string | null }) {
    const invalid = (field: string) => new AppError("VALIDATION_FAILED", `Unknown ${field}`, { [field]: ["Unknown"] });
    if (input.projectId && !(await tx.project.count({ id: input.projectId, tenantId: ctx.tenantId }))) throw invalid("projectId");
    if (input.contactId || input.dealId) {
      const { where } = await ownerScope(tx, ctx, "contacts.view_all");
      if (input.contactId && !(await tx.contact.count(and({ id: input.contactId, tenantId: ctx.tenantId, deletedAt: null }, where)))) {
        throw invalid("contactId");
      }
      if (input.dealId && !(await tx.deal.count(and({ id: input.dealId, tenantId: ctx.tenantId }, where)))) throw invalid("dealId");
    }
  }

  private async actorName(tx: Tx, ctx: AuthedContext) {
    return (await memberRefs(tx, ctx.tenantId, [ctx.membershipId])).get(ctx.membershipId)?.name ?? "";
  }

  async toDtos(tx: Tx, ctx: AuthedContext, rows: Task[]): Promise<TaskDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const present = (values: (string | null)[]) => [...new Set(values.filter((x): x is string => !!x))];
    const [refs, contacts, deals, projects, subtasks, comments, files] = await Promise.all([
      memberRefs(tx, ctx.tenantId, rows.flatMap((r) => [r.assigneeId, r.creatorId])),
      tx.contact.find({ tenantId: ctx.tenantId, id: { $in: present(rows.map((r) => r.contactId)) } }, { projection: { id: 1, name: 1 } }),
      tx.deal.find({ tenantId: ctx.tenantId, id: { $in: present(rows.map((r) => r.dealId)) } }, { projection: { id: 1, title: 1 } }),
      tx.project.find({ tenantId: ctx.tenantId, id: { $in: present(rows.map((r) => r.projectId)) } }, { projection: { id: 1, name: 1 } }),
      tx.task.find({ tenantId: ctx.tenantId, parentId: { $in: ids } }, { projection: { parentId: 1, status: 1 } }),
      countBy(tx.taskComment, "taskId", { tenantId: ctx.tenantId, taskId: { $in: ids } }),
      countBy(tx.fileObject, "entityId", { tenantId: ctx.tenantId, entityType: "task", entityId: { $in: ids } }),
    ]);
    const contactById = new Map(contacts.map((c) => [c.id, { id: c.id, name: c.name }]));
    const dealById = new Map(deals.map((d) => [d.id, { id: d.id, title: d.title }]));
    const projectById = new Map(projects.map((p) => [p.id, { id: p.id, name: p.name }]));
    const subsOf = (id: string) => subtasks.filter((s) => s.parentId === id);
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
      project: (t.projectId && projectById.get(t.projectId)) || null,
      parentId: t.parentId,
      contact: (t.contactId && contactById.get(t.contactId)) || null,
      deal: (t.dealId && dealById.get(t.dealId)) || null,
      subtasks: { done: subsOf(t.id).filter((s) => s.status === "DONE").length, total: subsOf(t.id).length },
      comments: comments.get(t.id)?.count ?? 0,
      files: files.get(t.id)?.count ?? 0,
      position: t.position,
      createdAt: t.createdAt.toISOString(),
      can: { edit: this.canEdit(ctx, t), delete: this.canDelete(ctx, t) },
    }));
  }
}
