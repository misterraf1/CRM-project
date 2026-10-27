import type { MemberRefDto } from "./crm-types";
import type { ChatRoomKind } from "./chat-schemas";
import type { TaskStatus } from "./task-schemas";

export interface ChatRoomDto {
  id: string;
  kind: ChatRoomKind;
  /** Group/department name, or the other person's name for direct chats */
  name: string;
  memberCount: number;
  unread: number;
  lastMessage: { body: string; author: string | null; mine: boolean; createdAt: string } | null;
}

export interface ChatAttachmentDto {
  fileId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

export interface ChatMessageDto {
  id: string;
  roomId: string;
  author: MemberRefDto | null;
  body: string | null;
  attachments: ChatAttachmentDto[];
  /** Null when no task is linked or the viewer can't see the linked task */
  task: { id: string; title: string; status: TaskStatus } | null;
  createdAt: string;
  editedAt: string | null;
  mine: boolean;
}

export interface ChatRoomDetailDto extends ChatRoomDto {
  members: (MemberRefDto & { title: string | null })[];
  messages: ChatMessageDto[];
  /** More history exists before the first returned message */
  hasMore: boolean;
  can: { addMembers: boolean; leave: boolean };
}

export interface ChatSearchHitDto {
  message: ChatMessageDto;
  room: { id: string; name: string; kind: ChatRoomKind };
}

/** Server-sent events on /v1/chat/stream — delivered only to room members */
export type ChatEvent = { type: "message" | "room"; roomId: string };
