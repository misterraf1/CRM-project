import type { FileDto, FileListItemDto, FileListQuery, FileListResponse, FileSource } from "@/shared";
import { authedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { newId } from "../common/ids";
import { memberRefs } from "../crm/scope";
import { limitsOf, storageUsed, subscriptionOf } from "../billing/entitlements.service";
import type { Database } from "../db/database";
import { and, contains } from "../db/query";
import type { Filter } from "../db/repo";
import type { FileStorage } from "../storage/storage.service";
import { taskScope, TasksService } from "./tasks.service";

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Upload filename (already UTF-8: "müqavilə") without control and path characters. */
export function displayName(raw: string) {
  return raw.replace(/[\u0000-\u001f\\/]/g, "_").slice(0, 200) || "file";
}

export class FilesService {
  constructor(
    private readonly db: Database,
    private readonly tasks: TasksService,
    private readonly storage: FileStorage,
  ) {}

  async uploadToTask(taskId: string, file: UploadedFile | undefined): Promise<FileDto> {
    const ctx = authedContext();
    await this.db.scoped((tx) => this.tasks.findVisible(tx, ctx, taskId));
    return this.store({ entityType: "task", entityId: taskId }, file);
  }

  /**
   * Stores an upload for any entity after the caller has checked access to it:
   * enforces the plan's storage quota, writes the record, then the blob.
   */
  async store(target: { entityType: "task" | "chat" | "library"; entityId: string | null }, file: UploadedFile | undefined): Promise<FileDto> {
    const ctx = authedContext();
    if (!file) throw new AppError("VALIDATION_FAILED", "No file", { file: ["Required"] });
    const id = newId("fil");
    const key = `tenants/${ctx.tenantId}/${id}`;

    const record = await this.db.scoped(async (tx) => {
      // Storage quota = plan (or the company override) + purchased add-on
      const [sub, usedBytes] = await Promise.all([subscriptionOf(tx, ctx.tenantId), storageUsed(tx, ctx.tenantId)]);
      const limit = limitsOf(sub).storageMb * 1024 * 1024;
      if (usedBytes + file.size > limit) {
        throw new AppError("STORAGE_LIMIT", "Storage limit reached", { usedMb: Math.ceil(usedBytes / 1048576), limitMb: Math.floor(limit / 1048576) });
      }
      return tx.fileObject.insertOne({
          id,
          tenantId: ctx.tenantId,
          uploaderId: ctx.membershipId,
          key,
          // Display name only; never used as a path
          name: displayName(file.originalname),
          mimeType: file.mimetype.slice(0, 100) || "application/octet-stream",
          sizeBytes: file.size,
          entityType: target.entityType,
          entityId: target.entityId,
      });
    });

    try {
      await this.storage.put(key, file.buffer);
    } catch (e) {
      await this.db.scoped((tx) => tx.fileObject.delete({ id }));
      throw e;
    }
    const refs = await this.db.scoped((tx) => memberRefs(tx, ctx.tenantId, [ctx.membershipId]));
    const me = refs.get(ctx.membershipId);
    return {
      id,
      name: record.name,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      uploader: me ? { id: me.id, name: me.name } : null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  /** Returns the record after checking the caller can see the task it belongs to. */
  async open(id: string) {
    const ctx = authedContext();
    const file = await this.db.scoped(async (tx) => {
      const f = await tx.fileObject.findOne({ id, tenantId: ctx.tenantId });
      if (!f) throw notFound("File");
      // Library files belong to the whole company
      if (f.entityType === "task" && f.entityId) await this.tasks.findVisible(tx, ctx, f.entityId).catch(() => {
        throw notFound("File");
      });
      // Chat files: only current members of the room (entityId = room id)
      if (f.entityType === "chat" && !(await tx.chatMember.count({ roomId: f.entityId ?? "", memberId: ctx.membershipId }))) {
        throw notFound("File");
      }
      return f;
    });
    return { file, stream: await this.storage.read(file.key) };
  }

  async remove(id: string) {
    const ctx = authedContext();
    const key = await this.db.scoped(async (tx) => {
      const f = await tx.fileObject.findOne({ id, tenantId: ctx.tenantId });
      if (f?.entityType === "library") {
        if (!this.canDeleteLibrary(f.uploaderId)) throw forbidden("Not allowed to delete this file");
        await tx.fileObject.delete({ id });
        return f.key;
      }
      // Chat attachments are removed together with their message
      if (!f || f.entityType !== "task" || !f.entityId) throw notFound("File");
      const task = await this.tasks.findVisible(tx, ctx, f.entityId).catch(() => {
        throw notFound("File");
      });
      if (f.uploaderId !== ctx.membershipId && !this.tasks.canEdit(ctx, task)) throw forbidden("Not allowed to delete this file");
      await tx.fileObject.delete({ id });
      return f.key;
    });
    await this.storage.remove(key);
  }

  /** Library files: the uploader, owners and admins may delete them. */
  private canDeleteLibrary(uploaderId: string) {
    const ctx = authedContext();
    return uploaderId === ctx.membershipId || ctx.role === "OWNER" || ctx.role === "ADMIN";
  }

  uploadToLibrary(file: UploadedFile | undefined) {
    return this.store({ entityType: "library", entityId: null }, file);
  }

  /**
   * Every file the caller may open: the company library, files of tasks they can see,
   * and files of chat rooms they belong to (chats stay private, even to owners).
   */
  async list(q: FileListQuery): Promise<FileListResponse> {
    const ctx = authedContext();
    const PAGE = 50;
    return this.db.scoped(async (tx) => {
      const { where: taskWhere, memberIds } = await taskScope(tx, ctx);
      const [rooms, visibleTasks] = await Promise.all([
        tx.chatMember.find({ tenantId: ctx.tenantId, memberId: ctx.membershipId }, { projection: { roomId: 1 } }),
        memberIds ? tx.task.find(and({ tenantId: ctx.tenantId }, taskWhere), { projection: { id: 1 } }) : null,
      ]);
      const visible: Filter[] = [
        { entityType: "library" },
        visibleTasks ? { entityType: "task", entityId: { $in: visibleTasks.map((t) => t.id) } } : { entityType: "task" },
        { entityType: "chat", entityId: { $in: rooms.map((r) => r.roomId) } },
      ];
      const where = and({ tenantId: ctx.tenantId, $or: visible }, q.source ? { entityType: q.source } : {}, q.q ? { name: contains(q.q) } : {});
      const [rows, total, sub, used] = await Promise.all([
        tx.fileObject.find(where, { sort: { createdAt: -1 }, skip: (q.page - 1) * PAGE, limit: PAGE }),
        tx.fileObject.count(where),
        subscriptionOf(tx, ctx.tenantId),
        storageUsed(tx, ctx.tenantId),
      ]);
      const taskIds = rows.filter((f) => f.entityType === "task").map((f) => f.entityId!);
      const roomIds = rows.filter((f) => f.entityType === "chat").map((f) => f.entityId!);
      const [tasks, chatRooms, refs] = await Promise.all([
        tx.task.find({ tenantId: ctx.tenantId, id: { $in: taskIds } }, { projection: { id: 1, title: 1, creatorId: 1, assigneeId: 1 } }),
        tx.chatRoom.find({ tenantId: ctx.tenantId, id: { $in: roomIds } }, { projection: { id: 1, name: 1, kind: 1 } }),
        memberRefs(tx, ctx.tenantId, rows.map((f) => f.uploaderId)),
      ]);
      const taskById = new Map(tasks.map((t) => [t.id, t]));
      const roomById = new Map(chatRooms.map((r) => [r.id, r]));
      const items: FileListItemDto[] = rows.map((f) => {
        const type = (f.entityType ?? "library") as FileSource;
        const task = type === "task" ? taskById.get(f.entityId!) : undefined;
        const room = type === "chat" ? roomById.get(f.entityId!) : undefined;
        const uploader = refs.get(f.uploaderId);
        return {
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          uploader: uploader ? { id: uploader.id, name: uploader.name } : null,
          createdAt: f.createdAt.toISOString(),
          source: { type, id: f.entityId, title: task?.title ?? room?.name ?? null },
          canDelete:
            type === "library"
              ? this.canDeleteLibrary(f.uploaderId)
              : type === "task" && !!task && (f.uploaderId === ctx.membershipId || this.tasks.canEdit(ctx, task)),
        };
      });
      return {
        items,
        total,
        storage: { usedMb: Math.ceil(used / 1048576), limitMb: limitsOf(sub).storageMb },
      };
    });
  }
}
