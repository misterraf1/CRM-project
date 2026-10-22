import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, type ChatMessage, type ChatRoom } from "@prisma/client";
import type {
  ChatAttachmentDto,
  ChatMessageDto,
  ChatMessageInput,
  ChatRoomDetailDto,
  ChatRoomDto,
  ChatRoomKind,
  ChatSearchHitDto,
  GroupRoomInput,
} from "@axis/shared";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { memberRefs } from "../crm/scope";
import { PrismaService, type Tx } from "../prisma/prisma.service";
import { FILE_STORAGE, type FileStorage } from "../storage/storage.service";
import { FilesService, type UploadedFile } from "../tasks/files.service";
import { taskScope } from "../tasks/tasks.service";
import { ChatEvents } from "./events";
import { unreadByRoom } from "./unread";

const directKey = (a: string, b: string) => [a, b].sort().join(":");

/**
 * Internal team chat — separate tables and UI from customer conversations.
 * Access = current membership of the room; department rooms follow the
 * department, so someone who moves out loses access immediately.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger("Chat");

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ChatEvents,
    private readonly files: FilesService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async rooms(): Promise<ChatRoomDto[]> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      await this.syncDepartmentRoom(tx, ctx);
      const rooms = await tx.chatRoom.findMany({
        where: {
          tenantId: ctx.tenantId,
          members: { some: { memberId: ctx.membershipId } },
          OR: [{ kind: { not: "department" } }, { departmentId: ctx.departmentId ?? "__none__" }],
        },
        include: { _count: { select: { members: true } }, members: { select: { memberId: true } } },
      });
      const [unread, last] = await Promise.all([
        unreadByRoom(tx, ctx),
        Promise.all(rooms.map((r) => tx.chatMessage.findFirst({ where: { roomId: r.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }))),
      ]);
      const refs = await memberRefs(tx, ctx.tenantId, [...rooms.flatMap((r) => r.members.map((m) => m.memberId)), ...last.map((m) => m?.authorId)]);
      return rooms
        .map((r, i) => {
          const m = last[i];
          return {
            id: r.id,
            kind: r.kind as ChatRoomKind,
            name: this.roomName(r, r.members.map((x) => x.memberId), ctx, refs),
            memberCount: r._count.members,
            unread: unread.get(r.id) ?? 0,
            lastMessage: m
              ? {
                  body: m.body ?? (m.taskId ? "📌" : "📎"),
                  author: (m.authorId && refs.get(m.authorId)?.name) || null,
                  mine: m.authorId === ctx.membershipId,
                  createdAt: m.createdAt.toISOString(),
                }
              : null,
            _at: (m?.createdAt ?? r.createdAt).getTime(),
          };
        })
        .sort((a, b) => b._at - a._at)
        .map(({ _at, ...dto }) => dto);
    });
  }

  /** One direct room per pair of colleagues (get-or-create). */
  async direct(memberId: string): Promise<{ id: string }> {
    const ctx = authedContext();
    if (memberId === ctx.membershipId) throw new AppError("VALIDATION_FAILED", "Cannot chat with yourself", { memberId: ["Self"] });
    const key = directKey(ctx.membershipId, memberId);
    const find = () => this.prisma.scoped((tx) => tx.chatRoom.findUnique({ where: { tenantId_directKey: { tenantId: ctx.tenantId, directKey: key } } }));
    const existing = await find();
    if (existing) return { id: existing.id };
    try {
      return await this.prisma.scoped(async (tx) => {
        await this.assertActiveMembers(tx, ctx, [memberId]);
        const room = await tx.chatRoom.create({
          data: {
            tenantId: ctx.tenantId,
            kind: "direct",
            directKey: key,
            createdById: ctx.membershipId,
            members: { create: [ctx.membershipId, memberId].map((m) => ({ tenantId: ctx.tenantId, memberId: m })) },
          },
        });
        return { id: room.id };
      });
    } catch (e) {
      // Both people opened the chat at the same moment
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { id: (await find())!.id };
      throw e;
    }
  }

  async group(input: GroupRoomInput): Promise<{ id: string }> {
    const ctx = authedContext();
    const ids = [...new Set([ctx.membershipId, ...input.memberIds])];
    return this.prisma.scoped(async (tx) => {
      await this.assertActiveMembers(tx, ctx, ids);
      const room = await tx.chatRoom.create({
        data: {
          tenantId: ctx.tenantId,
          kind: "group",
          name: input.name,
          createdById: ctx.membershipId,
          members: { create: ids.map((m) => ({ tenantId: ctx.tenantId, memberId: m })) },
        },
      });
      this.events.publish(ids, { type: "room", roomId: room.id });
      return { id: room.id };
    });
  }

  async addMembers(roomId: string, memberIds: string[]) {
    const ctx = authedContext();
    await this.prisma.scoped(async (tx) => {
      const room = await this.access(tx, ctx, roomId);
      if (room.kind !== "group") throw forbidden("Members can be added to group chats only");
      await this.assertActiveMembers(tx, ctx, memberIds);
      await this.addMissingMembers(tx, ctx, roomId, memberIds);
      this.events.publish(await this.memberIds(tx, roomId), { type: "room", roomId });
    });
  }

  async leave(roomId: string) {
    const ctx = authedContext();
    await this.prisma.scoped(async (tx) => {
      const room = await this.access(tx, ctx, roomId);
      if (room.kind !== "group") throw forbidden("Only group chats can be left");
      await tx.chatMember.delete({ where: { roomId_memberId: { roomId, memberId: ctx.membershipId } } });
    });
  }

  async detail(roomId: string, before?: string, limit = 50): Promise<ChatRoomDetailDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      await this.syncDepartmentRoom(tx, ctx);
      const room = await this.access(tx, ctx, roomId);
      const memberIds = await this.memberIds(tx, roomId);
      const pivot = before ? await tx.chatMessage.findFirst({ where: { id: before, roomId } }) : null;
      const rows = await tx.chatMessage.findMany({
        where: { roomId, ...(pivot ? { createdAt: { lt: pivot.createdAt } } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit).reverse();
      const refs = await memberRefs(tx, ctx.tenantId, [...memberIds, ...page.map((m) => m.authorId)]);
      const unread = (await unreadByRoom(tx, ctx)).get(roomId) ?? 0;
      return {
        id: room.id,
        kind: room.kind as ChatRoomKind,
        name: this.roomName(room, memberIds, ctx, refs),
        memberCount: memberIds.length,
        unread,
        lastMessage: null,
        members: memberIds.map((id) => refs.get(id)).filter((m): m is NonNullable<typeof m> => !!m).map((m) => ({ id: m.id, name: m.name, title: m.title })),
        messages: await this.toDtos(tx, ctx, page),
        hasMore: rows.length > limit,
        can: { addMembers: room.kind === "group", leave: room.kind === "group" },
      };
    });
  }

  async send(roomId: string, input: ChatMessageInput): Promise<ChatMessageDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      await this.access(tx, ctx, roomId);
      if (input.taskId) await this.assertTaskVisible(tx, ctx, input.taskId);
      const message = await tx.chatMessage.create({
        data: { tenantId: ctx.tenantId, roomId, authorId: ctx.membershipId, body: input.body ?? null, taskId: input.taskId ?? null },
      });
      return this.afterWrite(tx, ctx, roomId, message);
    });
  }

  /** File (or image) message: stored with the quota rules shared with task files. */
  async upload(roomId: string, file: UploadedFile | undefined, caption?: string): Promise<ChatMessageDto> {
    const ctx = authedContext();
    await this.prisma.scoped((tx) => this.access(tx, ctx, roomId));
    const stored = await this.files.store({ entityType: "chat", entityId: roomId }, file);
    const attachment: ChatAttachmentDto = { fileId: stored.id, name: stored.name, sizeBytes: stored.sizeBytes, mimeType: stored.mimeType };
    return this.prisma.scoped(async (tx) => {
      const message = await tx.chatMessage.create({
        data: {
          tenantId: ctx.tenantId,
          roomId,
          authorId: ctx.membershipId,
          body: caption?.trim().slice(0, 4000) || null,
          attachments: [attachment] as unknown as Prisma.InputJsonArray,
        },
      });
      return this.afterWrite(tx, ctx, roomId, message);
    });
  }

  async edit(messageId: string, body: string): Promise<ChatMessageDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const m = await this.ownMessage(tx, ctx, messageId);
      const updated = await tx.chatMessage.update({ where: { id: m.id }, data: { body, editedAt: new Date() } });
      this.events.publish(await this.memberIds(tx, m.roomId), { type: "message", roomId: m.roomId });
      return (await this.toDtos(tx, ctx, [updated]))[0]!;
    });
  }

  async remove(messageId: string) {
    const ctx = authedContext();
    const keys = await this.prisma.scoped(async (tx) => {
      const m = await this.ownMessage(tx, ctx, messageId);
      const fileIds = this.attachments(m).map((a) => a.fileId);
      const files = await tx.fileObject.findMany({ where: { tenantId: ctx.tenantId, id: { in: fileIds } }, select: { key: true } });
      await tx.fileObject.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: fileIds } } });
      await tx.chatMessage.delete({ where: { id: m.id } });
      this.events.publish(await this.memberIds(tx, m.roomId), { type: "message", roomId: m.roomId });
      return files.map((f) => f.key);
    });
    for (const key of keys) await this.storage.remove(key).catch((e) => this.logger.warn(`Orphan blob ${key}: ${e}`));
  }

  async read(roomId: string) {
    const ctx = authedContext();
    await this.prisma.scoped(async (tx) => {
      await this.access(tx, ctx, roomId);
      await tx.chatMember.update({ where: { roomId_memberId: { roomId, memberId: ctx.membershipId } }, data: { lastReadAt: new Date() } });
    });
  }

  async search(q: string): Promise<ChatSearchHitDto[]> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const rows = await tx.chatMessage.findMany({
        where: {
          tenantId: ctx.tenantId,
          body: { contains: q, mode: "insensitive" },
          room: {
            members: { some: { memberId: ctx.membershipId } },
            OR: [{ kind: { not: "department" } }, { departmentId: ctx.departmentId ?? "__none__" }],
          },
        },
        include: { room: { include: { members: { select: { memberId: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      });
      const refs = await memberRefs(tx, ctx.tenantId, rows.flatMap((r) => r.room.members.map((m) => m.memberId)));
      const dtos = await this.toDtos(tx, ctx, rows);
      return rows.map((r, i) => ({
        message: dtos[i]!,
        room: { id: r.room.id, kind: r.room.kind as ChatRoomKind, name: this.roomName(r.room, r.room.members.map((m) => m.memberId), ctx, refs) },
      }));
    });
  }

  /** Room the caller may use, or 404 (same answer for "missing" and "not a member"). */
  private async access(tx: Tx, ctx: AuthedContext, roomId: string) {
    const room = await tx.chatRoom.findFirst({ where: { id: roomId, tenantId: ctx.tenantId, members: { some: { memberId: ctx.membershipId } } } });
    if (!room) throw notFound("Chat");
    if (room.kind === "department" && room.departmentId !== ctx.departmentId) {
      // Moved to another department: membership is stale, drop it
      await tx.chatMember.deleteMany({ where: { roomId, memberId: ctx.membershipId } });
      throw notFound("Chat");
    }
    return room;
  }

  /** Creates the caller's department room on first use and keeps its members in line with the department. */
  private async syncDepartmentRoom(tx: Tx, ctx: AuthedContext) {
    if (!ctx.departmentId) return;
    const dept = await tx.department.findFirst({ where: { id: ctx.departmentId, tenantId: ctx.tenantId } });
    if (!dept) return;
    const room =
      (await tx.chatRoom.findUnique({ where: { departmentId: dept.id } })) ??
      (await tx.chatRoom.create({ data: { tenantId: ctx.tenantId, kind: "department", departmentId: dept.id, name: dept.name } }));
    if (room.name !== dept.name) await tx.chatRoom.update({ where: { id: room.id }, data: { name: dept.name } });
    const current = (await tx.membership.findMany({ where: { tenantId: ctx.tenantId, departmentId: dept.id, status: "ACTIVE" }, select: { id: true } })).map((m) => m.id);
    await this.addMissingMembers(tx, ctx, room.id, current);
    await tx.chatMember.deleteMany({ where: { roomId: room.id, memberId: { notIn: current } } });
  }

  private async afterWrite(tx: Tx, ctx: AuthedContext, roomId: string, message: ChatMessage) {
    // Writing in a room counts as having read it
    await tx.chatMember.update({ where: { roomId_memberId: { roomId, memberId: ctx.membershipId } }, data: { lastReadAt: message.createdAt } });
    this.events.publish(await this.memberIds(tx, roomId), { type: "message", roomId });
    return (await this.toDtos(tx, ctx, [message]))[0]!;
  }

  /** createMany without duplicates (MongoDB has no skipDuplicates). */
  private async addMissingMembers(tx: Tx, ctx: AuthedContext, roomId: string, memberIds: string[]) {
    const existing = new Set((await tx.chatMember.findMany({ where: { roomId }, select: { memberId: true } })).map((m) => m.memberId));
    const missing = [...new Set(memberIds)].filter((m) => !existing.has(m));
    if (missing.length) await tx.chatMember.createMany({ data: missing.map((m) => ({ tenantId: ctx.tenantId, roomId, memberId: m })) });
  }

  private async ownMessage(tx: Tx, ctx: AuthedContext, messageId: string) {
    const m = await tx.chatMessage.findFirst({ where: { id: messageId, tenantId: ctx.tenantId } });
    if (!m) throw notFound("Message");
    await this.access(tx, ctx, m.roomId);
    if (m.authorId !== ctx.membershipId) throw forbidden("You can change only your own messages");
    return m;
  }

  private async assertTaskVisible(tx: Tx, ctx: AuthedContext, taskId: string) {
    const { where } = await taskScope(tx, ctx);
    if (!(await tx.task.count({ where: { AND: [{ id: taskId, tenantId: ctx.tenantId }, where] } }))) {
      throw new AppError("VALIDATION_FAILED", "Unknown task", { taskId: ["Unknown task"] });
    }
  }

  private async assertActiveMembers(tx: Tx, ctx: AuthedContext, ids: string[]) {
    const n = await tx.membership.count({ where: { tenantId: ctx.tenantId, status: "ACTIVE", id: { in: ids } } });
    if (n !== new Set(ids).size) throw new AppError("VALIDATION_FAILED", "Unknown member", { memberIds: ["Unknown member"] });
  }

  private async memberIds(tx: Tx, roomId: string) {
    return (await tx.chatMember.findMany({ where: { roomId }, select: { memberId: true } })).map((m) => m.memberId);
  }

  private roomName(room: ChatRoom, memberIds: string[], ctx: AuthedContext, refs: Map<string, { name: string }>) {
    if (room.kind !== "direct") return room.name ?? "";
    const other = memberIds.find((id) => id !== ctx.membershipId);
    return (other && refs.get(other)?.name) || "";
  }

  private attachments(m: ChatMessage): ChatAttachmentDto[] {
    return Array.isArray(m.attachments) ? (m.attachments as unknown as ChatAttachmentDto[]) : [];
  }

  /** Linked tasks are shown only to people who can see them. */
  private async toDtos(tx: Tx, ctx: AuthedContext, rows: ChatMessage[]): Promise<ChatMessageDto[]> {
    const taskIds = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))];
    const { where } = await taskScope(tx, ctx);
    const tasks = taskIds.length
      ? await tx.task.findMany({ where: { AND: [{ tenantId: ctx.tenantId, id: { in: taskIds } }, where] }, select: { id: true, title: true, status: true } })
      : [];
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const refs = await memberRefs(tx, ctx.tenantId, rows.map((r) => r.authorId));
    return rows.map((m) => {
      const a = refs.get(m.authorId);
      return {
        id: m.id,
        roomId: m.roomId,
        author: a ? { id: a.id, name: a.name } : null,
        body: m.body,
        attachments: this.attachments(m),
        task: (m.taskId && taskById.get(m.taskId)) || null,
        createdAt: m.createdAt.toISOString(),
        editedAt: m.editedAt?.toISOString() ?? null,
        mine: m.authorId === ctx.membershipId,
      };
    });
  }
}
