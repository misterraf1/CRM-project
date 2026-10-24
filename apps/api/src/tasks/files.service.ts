import { Inject, Injectable } from "@nestjs/common";
import type { FileDto, FileListItemDto, FileListQuery, FileListResponse, FileSource } from "@axis/shared";
import type { Prisma } from "@prisma/client";
import { authedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { newId } from "../common/ids";
import { memberRefs } from "../crm/scope";
import { PrismaService } from "../prisma/prisma.service";
import { FILE_STORAGE, type FileStorage } from "../storage/storage.service";
import { taskScope, TasksService } from "./tasks.service";

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Multipart filenames arrive latin1-decoded (busboy default), which turns "müqavilə"
 * into mojibake. Re-decode as UTF-8, then strip control and path characters.
 */
export function displayName(raw: string) {
  const utf8 = Buffer.from(raw, "latin1").toString("utf8");
  const name = utf8.includes("\uFFFD") ? raw : utf8;
  return name.replace(/[\u0000-\u001f\\/]/g, "_").slice(0, 200) || "file";
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async uploadToTask(taskId: string, file: UploadedFile | undefined): Promise<FileDto> {
    const ctx = authedContext();
    await this.prisma.scoped((tx) => this.tasks.findVisible(tx, ctx, taskId));
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

    const record = await this.prisma.scoped(async (tx) => {
      // Storage quota = plan + purchased add-on
      const [sub, used] = await Promise.all([
        tx.subscription.findUniqueOrThrow({ where: { tenantId: ctx.tenantId }, include: { plan: true } }),
        tx.fileObject.aggregate({ where: { tenantId: ctx.tenantId }, _sum: { sizeBytes: true } }),
      ]);
      const limit = (sub.plan.storageMb + sub.extraStorageMb) * 1024 * 1024;
      const usedBytes = used._sum.sizeBytes ?? 0;
      if (usedBytes + file.size > limit) {
        throw new AppError("STORAGE_LIMIT", "Storage limit reached", { usedMb: Math.ceil(usedBytes / 1048576), limitMb: Math.floor(limit / 1048576) });
      }
      return tx.fileObject.create({
        data: {
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
        },
      });
    });

    try {
      await this.storage.put(key, file.buffer);
    } catch (e) {
      await this.prisma.scoped((tx) => tx.fileObject.delete({ where: { id } }));
      throw e;
    }
    const refs = await this.prisma.scoped((tx) => memberRefs(tx, ctx.tenantId, [ctx.membershipId]));
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
    const file = await this.prisma.scoped(async (tx) => {
      const f = await tx.fileObject.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!f) throw notFound("File");
      // Library files belong to the whole company
      if (f.entityType === "task" && f.entityId) await this.tasks.findVisible(tx, ctx, f.entityId).catch(() => {
        throw notFound("File");
      });
      // Chat files: only current members of the room (entityId = room id)
      if (f.entityType === "chat" && !(await tx.chatMember.count({ where: { roomId: f.entityId ?? "", memberId: ctx.membershipId } }))) {
        throw notFound("File");
      }
      return f;
    });
    return { file, stream: this.storage.read(file.key) };
  }

  async remove(id: string) {
    const ctx = authedContext();
    const key = await this.prisma.scoped(async (tx) => {
      const f = await tx.fileObject.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (f?.entityType === "library") {
        if (!this.canDeleteLibrary(f.uploaderId)) throw forbidden("Not allowed to delete this file");
        await tx.fileObject.delete({ where: { id } });
        return f.key;
      }
      // Chat attachments are removed together with their message
      if (!f || f.entityType !== "task" || !f.entityId) throw notFound("File");
      const task = await this.tasks.findVisible(tx, ctx, f.entityId).catch(() => {
        throw notFound("File");
      });
      if (f.uploaderId !== ctx.membershipId && !this.tasks.canEdit(ctx, task)) throw forbidden("Not allowed to delete this file");
      await tx.fileObject.delete({ where: { id } });
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
    return this.prisma.scoped(async (tx) => {
      const { where: taskWhere, memberIds } = await taskScope(tx, ctx);
      const [rooms, visibleTasks] = await Promise.all([
        tx.chatMember.findMany({ where: { tenantId: ctx.tenantId, memberId: ctx.membershipId }, select: { roomId: true } }),
        memberIds ? tx.task.findMany({ where: { AND: [{ tenantId: ctx.tenantId }, taskWhere] }, select: { id: true } }) : null,
      ]);
      const visible: Prisma.FileObjectWhereInput[] = [
        { entityType: "library" },
        visibleTasks ? { entityType: "task", entityId: { in: visibleTasks.map((t) => t.id) } } : { entityType: "task" },
        { entityType: "chat", entityId: { in: rooms.map((r) => r.roomId) } },
      ];
      const where: Prisma.FileObjectWhereInput = {
        AND: [
          { tenantId: ctx.tenantId, OR: visible },
          ...(q.source ? [{ entityType: q.source }] : []),
          ...(q.q ? [{ name: { contains: q.q, mode: "insensitive" as const } }] : []),
        ],
      };
      const [rows, total, sub, used] = await Promise.all([
        tx.fileObject.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * PAGE, take: PAGE }),
        tx.fileObject.count({ where }),
        tx.subscription.findUniqueOrThrow({ where: { tenantId: ctx.tenantId }, include: { plan: true } }),
        tx.fileObject.aggregate({ where: { tenantId: ctx.tenantId }, _sum: { sizeBytes: true } }),
      ]);
      const taskIds = rows.filter((f) => f.entityType === "task").map((f) => f.entityId!);
      const roomIds = rows.filter((f) => f.entityType === "chat").map((f) => f.entityId!);
      const [tasks, chatRooms, refs] = await Promise.all([
        tx.task.findMany({ where: { tenantId: ctx.tenantId, id: { in: taskIds } }, select: { id: true, title: true, creatorId: true, assigneeId: true } }),
        tx.chatRoom.findMany({ where: { tenantId: ctx.tenantId, id: { in: roomIds } }, select: { id: true, name: true, kind: true } }),
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
        storage: { usedMb: Math.ceil((used._sum.sizeBytes ?? 0) / 1048576), limitMb: sub.plan.storageMb + sub.extraStorageMb },
      };
    });
  }
}
