import { z } from "zod";

const id = z.string().min(1).max(64);

export const CHAT_ROOM_KINDS = ["direct", "department", "group"] as const;
export type ChatRoomKind = (typeof CHAT_ROOM_KINDS)[number];

export const directRoomSchema = z.object({ memberId: id });

export const groupRoomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  memberIds: z.array(id).min(1).max(100),
});
export type GroupRoomInput = z.infer<typeof groupRoomSchema>;

export const addMembersSchema = z.object({ memberIds: z.array(id).min(1).max(100) });

export const chatMessageSchema = z
  .object({
    body: z.string().trim().max(4000).optional(),
    /** Link an existing task the sender can see */
    taskId: id.optional(),
  })
  .refine((v) => !!v.body || !!v.taskId, { message: "Message is empty" });
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const chatEditSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const chatHistoryQuerySchema = z.object({
  /** Message id: load older messages before it */
  before: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const chatSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });
