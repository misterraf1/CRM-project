import { Logger } from "../common/logger";
import type { ChatMessage, ChatRoom } from "../db/models";
import type {
  ChatAttachmentDto,
  ChatMessageDto,
  ChatMessageInput,
  ChatRoomDetailDto,
  ChatRoomDto,
  ChatRoomKind,
  ChatSearchHitDto,
  GroupRoomInput,
} from "@/shared";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { memberRefs } from "../crm/scope";
import type { Database, Tx } from "../db/database";
import { isDuplicateKey } from "../db/errors";
import { and, contains, groupBy } from "../db/query";
import type { FileStorage } from "../storage/storage.service";
import { FilesService, type UploadedFile } from "../tasks/files.service";
import { taskScope } from "../tasks/tasks.service";
import { ChatEvents } from "./events";
import { unreadByRoom, visibleRoomIds } from "./unread";

const directKey = (a: string, b: string) => [a, b].sort().join(":");

/**
 * Internal team chat — separate tables and UI from customer conversations.
 * Access = current membership of the room; department rooms follow the
 * department, so someone who moves out loses access immediately.
 */
export class ChatService {
  private readonly logger = new Logger("Chat");

  constructor(
    private readonly db: Database,
    private readonly events: ChatEvents,
    private readonly files: FilesService,
    private readonly storage: FileStorage,
  ) {}

  async rooms(): Promise<ChatRoomDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      await this.syncDepartmentRoom(tx, ctx);
      const roomIds = [...(await this.myVisibleRooms(tx, ctx))];
      const [rooms, members] = await Promise.all([
        tx.chatRoom.find({ tenantId: ctx.tenantId, id: { $in: roomIds } }),
        tx.chatMember.find({ tenantId: ctx.tenantId, roomId: { $in: roomIds } }, { projection: { roomId: 1, memberId: 1 } }),
      ]);
      const membersOf = groupBy(members, (m) => m.roomId);
      const [unread, last] = await Promise.all([
        unreadByRoom(tx, ctx),
        Promise.all(rooms.map((r) => tx.chatMessage.findOne({ roomId: r.id }, { sort: { createdAt: -1, id: -1 } }))),
      ]);
      const refs = await memberRefs(tx, ctx.tenantId, [...members.map((m) => m.memberId), ...last.map((m) => m?.authorId)]);
      return rooms
        .map((r, i) => {
          const m = last[i];
          return {
            id: r.id,
            kind: r.kind as ChatRoomKind,
            name: this.roomName(r, (membersOf.get(r.id) ?? []).map((x) => x.memberId), ctx, refs),
            memberCount: membersOf.get(r.id)?.length ?? 0,
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
    const find = () => this.db.scoped((tx) => tx.chatRoom.findOne({ tenantId: ctx.tenantId, directKey: key }));
    const existing = await find();
    if (existing) return { id: existing.id };
    try {
      return await this.db.scoped(async (tx) => {
        await this.assertActiveMembers(tx, ctx, [memberId]);
        const room = await tx.chatRoom.insertOne({ tenantId: ctx.tenantId, kind: "direct", directKey: key, createdById: ctx.membershipId });
        await tx.chatMember.insertMany([ctx.membershipId, memberId].map((m) => ({ tenantId: ctx.tenantId, roomId: room.id, memberId: m })));
        return { id: room.id };
      });
    } catch (e) {
      // Both people opened the chat at the same moment
      if (isDuplicateKey(e)) return { id: (await find())!.id };
      throw e;
    }
  }

  async group(input: GroupRoomInput): Promise<{ id: string }> {
    const ctx = authedContext();
    const ids = [...new Set([ctx.membershipId, ...input.memberIds])];
    return this.db.scoped(async (tx) => {
      await this.assertActiveMembers(tx, ctx, ids);
      const room = await tx.chatRoom.insertOne({ tenantId: ctx.tenantId, kind: "group", name: input.name, createdById: ctx.membershipId });
      await tx.chatMember.insertMany(ids.map((m) => ({ tenantId: ctx.tenantId, roomId: room.id, memberId: m })));
      this.events.publish(ids, { type: "room", roomId: room.id });
      return { id: room.id };
    });
  }

  async addMembers(roomId: string, memberIds: string[]) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const room = await this.access(tx, ctx, roomId);
      if (room.kind !== "group") throw forbidden("Members can be added to group chats only");
      await this.assertActiveMembers(tx, ctx, memberIds);
      await this.addMissingMembers(tx, ctx, roomId, memberIds);
      this.events.publish(await this.memberIds(tx, roomId), { type: "room", roomId });
    });
  }

  async leave(roomId: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const room = await this.access(tx, ctx, roomId);
      if (room.kind !== "group") throw forbidden("Only group chats can be left");
      await tx.chatMember.delete({ roomId, memberId: ctx.membershipId });
    });
  }

  async detail(roomId: string, before?: string, limit = 50): Promise<ChatRoomDetailDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      await this.syncDepartmentRoom(tx, ctx);
      const room = await this.access(tx, ctx, roomId);
      const memberIds = await this.memberIds(tx, roomId);
      const pivot = before ? await tx.chatMessage.findOne({ id: before, roomId }) : null;
      const rows = await tx.chatMessage.find({ roomId, ...(pivot ? { createdAt: { $lt: pivot.createdAt } } : {}) }, { sort: { createdAt: -1, id: -1 }, limit: limit + 1 });
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
    return this.db.scoped(async (tx) => {
      await this.access(tx, ctx, roomId);
      if (input.taskId) await this.assertTaskVisible(tx, ctx, input.taskId);
      const message = await tx.chatMessage.insertOne({ tenantId: ctx.tenantId, roomId, authorId: ctx.membershipId, body: input.body ?? null, taskId: input.taskId ?? null });
      return this.afterWrite(tx, ctx, roomId, message);
    });
  }

  /** File (or image) message: stored with the quota rules shared with task files. */
  async upload(roomId: string, file: UploadedFile | undefined, caption?: string): Promise<ChatMessageDto> {
    const ctx = authedContext();
    await this.db.scoped((tx) => this.access(tx, ctx, roomId));
    const stored = await this.files.store({ entityType: "chat", entityId: roomId }, file);
    const attachment: ChatAttachmentDto = { fileId: stored.id, name: stored.name, sizeBytes: stored.sizeBytes, mimeType: stored.mimeType };
    return this.db.scoped(async (tx) => {
      const message = await tx.chatMessage.insertOne({
        tenantId: ctx.tenantId,
        roomId,
        authorId: ctx.membershipId,
        body: caption?.trim().slice(0, 4000) || null,
        attachments: [attachment] as unknown as ChatMessage["attachments"],
      });
      return this.afterWrite(tx, ctx, roomId, message);
    });
  }

  async edit(messageId: string, body: string): Promise<ChatMessageDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const m = await this.ownMessage(tx, ctx, messageId);
      const updated = await tx.chatMessage.update({ id: m.id }, { $set: { body, editedAt: new Date() } });
      this.events.publish(await this.memberIds(tx, m.roomId), { type: "message", roomId: m.roomId });
      return (await this.toDtos(tx, ctx, [updated]))[0]!;
    });
  }

  async remove(messageId: string) {
    const ctx = authedContext();
    const keys = await this.db.scoped(async (tx) => {
      const m = await this.ownMessage(tx, ctx, messageId);
      const fileIds = this.attachments(m).map((a) => a.fileId);
      const files = await tx.fileObject.find({ tenantId: ctx.tenantId, id: { $in: fileIds } }, { projection: { key: 1 } });
      await tx.fileObject.deleteMany({ tenantId: ctx.tenantId, id: { $in: fileIds } });
      await tx.chatMessage.delete({ id: m.id });
      this.events.publish(await this.memberIds(tx, m.roomId), { type: "message", roomId: m.roomId });
      return files.map((f) => f.key);
    });
    for (const key of keys) await this.storage.remove(key).catch((e) => this.logger.warn(`Orphan blob ${key}: ${e}`));
  }

  async read(roomId: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      await this.access(tx, ctx, roomId);
      await tx.chatMember.update({ roomId, memberId: ctx.membershipId }, { $set: { lastReadAt: new Date() } });
    });
  }

  async search(q: string): Promise<ChatSearchHitDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const roomIds = [...(await this.myVisibleRooms(tx, ctx))];
      const rows = await tx.chatMessage.find({ tenantId: ctx.tenantId, roomId: { $in: roomIds }, body: contains(q) }, { sort: { createdAt: -1 }, limit: 30 });
      const hitRooms = [...new Set(rows.map((r) => r.roomId))];
      const [rooms, members] = await Promise.all([
        tx.chatRoom.find({ tenantId: ctx.tenantId, id: { $in: hitRooms } }),
        tx.chatMember.find({ tenantId: ctx.tenantId, roomId: { $in: hitRooms } }, { projection: { roomId: 1, memberId: 1 } }),
      ]);
      const roomById = new Map(rooms.map((r) => [r.id, r]));
      const membersOf = groupBy(members, (m) => m.roomId);
      const refs = await memberRefs(tx, ctx.tenantId, members.map((m) => m.memberId));
      const dtos = await this.toDtos(tx, ctx, rows);
      return rows.map((r, i) => {
        const room = roomById.get(r.roomId)!;
        return {
          message: dtos[i]!,
          room: { id: room.id, kind: room.kind as ChatRoomKind, name: this.roomName(room, (membersOf.get(room.id) ?? []).map((m) => m.memberId), ctx, refs) },
        };
      });
    });
  }

  /** Room the caller may use, or 404 (same answer for "missing" and "not a member"). */
  private async access(tx: Tx, ctx: AuthedContext, roomId: string) {
    const member = await tx.chatMember.count({ tenantId: ctx.tenantId, roomId, memberId: ctx.membershipId });
    const room = member ? await tx.chatRoom.findOne({ id: roomId, tenantId: ctx.tenantId }) : null;
    if (!room) throw notFound("Chat");
    if (room.kind === "department" && room.departmentId !== ctx.departmentId) {
      // Moved to another department: membership is stale, drop it
      await tx.chatMember.deleteMany({ roomId, memberId: ctx.membershipId });
      throw notFound("Chat");
    }
    return room;
  }

  /** Creates the caller's department room on first use and keeps its members in line with the department. */
  private async syncDepartmentRoom(tx: Tx, ctx: AuthedContext) {
    if (!ctx.departmentId) return;
    const dept = await tx.department.findOne({ id: ctx.departmentId, tenantId: ctx.tenantId });
    if (!dept) return;
    const room =
      (await tx.chatRoom.findOne({ departmentId: dept.id })) ??
      (await tx.chatRoom.insertOne({ tenantId: ctx.tenantId, kind: "department", departmentId: dept.id, name: dept.name }));
    if (room.name !== dept.name) await tx.chatRoom.update({ id: room.id }, { $set: { name: dept.name } });
    const current = (await tx.membership.find({ tenantId: ctx.tenantId, departmentId: dept.id, status: "ACTIVE" }, { projection: { id: 1 } })).map((m) => m.id);
    await this.addMissingMembers(tx, ctx, room.id, current);
    await tx.chatMember.deleteMany({ roomId: room.id, memberId: { $nin: current } });
  }

  private async afterWrite(tx: Tx, ctx: AuthedContext, roomId: string, message: ChatMessage) {
    // Writing in a room counts as having read it
    await tx.chatMember.update({ roomId, memberId: ctx.membershipId }, { $set: { lastReadAt: message.createdAt } });
    this.events.publish(await this.memberIds(tx, roomId), { type: "message", roomId });
    return (await this.toDtos(tx, ctx, [message]))[0]!;
  }

  /** Rooms the caller belongs to and may currently see. */
  private async myVisibleRooms(tx: Tx, ctx: AuthedContext) {
    const mine = await tx.chatMember.find({ tenantId: ctx.tenantId, memberId: ctx.membershipId }, { projection: { roomId: 1 } });
    return visibleRoomIds(tx, ctx, mine.map((m) => m.roomId));
  }

  /** Adds members who aren't in the room yet. */
  private async addMissingMembers(tx: Tx, ctx: AuthedContext, roomId: string, memberIds: string[]) {
    const existing = new Set((await tx.chatMember.find({ roomId }, { projection: { memberId: 1 } })).map((m) => m.memberId));
    const missing = [...new Set(memberIds)].filter((m) => !existing.has(m));
    await tx.chatMember.insertMany(missing.map((m) => ({ tenantId: ctx.tenantId, roomId, memberId: m })));
  }

  private async ownMessage(tx: Tx, ctx: AuthedContext, messageId: string) {
    const m = await tx.chatMessage.findOne({ id: messageId, tenantId: ctx.tenantId });
    if (!m) throw notFound("Message");
    await this.access(tx, ctx, m.roomId);
    if (m.authorId !== ctx.membershipId) throw forbidden("You can change only your own messages");
    return m;
  }

  private async assertTaskVisible(tx: Tx, ctx: AuthedContext, taskId: string) {
    const { where } = await taskScope(tx, ctx);
    if (!(await tx.task.count(and({ id: taskId, tenantId: ctx.tenantId }, where)))) {
      throw new AppError("VALIDATION_FAILED", "Unknown task", { taskId: ["Unknown task"] });
    }
  }

  private async assertActiveMembers(tx: Tx, ctx: AuthedContext, ids: string[]) {
    const n = await tx.membership.count({ tenantId: ctx.tenantId, status: "ACTIVE", id: { $in: ids } });
    if (n !== new Set(ids).size) throw new AppError("VALIDATION_FAILED", "Unknown member", { memberIds: ["Unknown member"] });
  }

  private async memberIds(tx: Tx, roomId: string) {
    return (await tx.chatMember.find({ roomId }, { projection: { memberId: 1 } })).map((m) => m.memberId);
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
      ? await tx.task.find(and({ tenantId: ctx.tenantId, id: { $in: taskIds } }, where), { projection: { id: 1, title: 1, status: 1 } })
      : [];
    const taskById = new Map(tasks.map((t) => [t.id, { id: t.id, title: t.title, status: t.status }]));
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
