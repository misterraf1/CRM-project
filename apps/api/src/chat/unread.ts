import type { AuthedContext } from "../common/context";
import type { Tx } from "../prisma/prisma.service";

// Kept free of service imports: the notifications summary needs it, and importing
// the chat service there would create a module cycle (chat → files → tasks → notifications).

/** Unread messages per room for the caller (messages by others after their last read). */
export async function unreadByRoom(tx: Tx, ctx: AuthedContext) {
  const memberships = await tx.chatMember.findMany({
    where: {
      tenantId: ctx.tenantId,
      memberId: ctx.membershipId,
      // A department room counts only while the caller is in that department
      room: { OR: [{ kind: { not: "department" } }, { departmentId: ctx.departmentId ?? "__none__" }] },
    },
    select: { roomId: true, lastReadAt: true },
  });
  const counts = await Promise.all(
    memberships.map((m) =>
      tx.chatMessage.count({
        where: { roomId: m.roomId, authorId: { not: ctx.membershipId }, ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}) },
      }),
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
