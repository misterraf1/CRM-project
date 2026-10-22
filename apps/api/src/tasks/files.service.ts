import { Inject, Injectable } from "@nestjs/common";
import type { FileDto } from "@axis/shared";
import { authedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { newId } from "../common/ids";
import { memberRefs } from "../crm/scope";
import { PrismaService } from "../prisma/prisma.service";
import { FILE_STORAGE, type FileStorage } from "../storage/storage.service";
import { TasksService } from "./tasks.service";

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
    if (!file) throw new AppError("VALIDATION_FAILED", "No file", { file: ["Required"] });
    const id = newId("fil");
    const key = `tenants/${ctx.tenantId}/${id}`;

    const record = await this.prisma.scoped(async (tx) => {
      await this.tasks.findVisible(tx, ctx, taskId);
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
          entityType: "task",
          entityId: taskId,
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
      if (f.entityType === "task" && f.entityId) await this.tasks.findVisible(tx, ctx, f.entityId).catch(() => {
        throw notFound("File");
      });
      return f;
    });
    return { file, stream: this.storage.read(file.key) };
  }

  async remove(id: string) {
    const ctx = authedContext();
    const key = await this.prisma.scoped(async (tx) => {
      const f = await tx.fileObject.findFirst({ where: { id, tenantId: ctx.tenantId } });
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
}
