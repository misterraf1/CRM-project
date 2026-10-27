import type { AuthedContext } from "../common/context";
import type { Tx } from "../db/database";

// Kept free of service imports: the notifications summary needs it, and importing
// the chat service there would create a module cycle (chat → files → tasks → notifications).

/** Rooms of the caller that count: a department room only while the caller is in that department. */
export async function visibleRoomIds(tx: Tx, ctx: AuthedContext, roomIds: string[]) {
  if (!roomIds.length) return new Set<string>();
  const rooms = await tx.chatRoom.find(
    { tenantId: ctx.tenantId, id: { $in: roomIds }, $or: [{ kind: { $ne: "department" } }, { departmentId: ctx.departmentId ?? "__none__" }] },
    { projection: { id: 1 } },
  );
  return new Set(rooms.map((r) => r.id));
}

/** Unread messages per room for the caller (messages by others after their last read). */
export async function unreadByRoom(tx: Tx, ctx: AuthedContext) {
  const all = await tx.chatMember.find({ tenantId: ctx.tenantId, memberId: ctx.membershipId }, { projection: { roomId: 1, lastReadAt: 1 } });
  const visible = await visibleRoomIds(tx, ctx, all.map((m) => m.roomId));
  const memberships = all.filter((m) => visible.has(m.roomId));
  const counts = await Promise.all(
    memberships.map((m) =>
      tx.chatMessage.count({ roomId: m.roomId, authorId: { $ne: ctx.membershipId }, ...(m.lastReadAt ? { createdAt: { $gt: m.lastReadAt } } : {}) }),
    ),
  );
  return new Map(memberships.map((m, i) => [m.roomId, counts[i]!]));
}

/** Shell badge: total unread team-chat messages. */
export async function unreadChatTotal(tx: Tx, ctx: AuthedContext) {
  let total = 0;
  for (const n of (await unreadByRoom(tx, ctx)).values()) total += n;
  return total;
}
