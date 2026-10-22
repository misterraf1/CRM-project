import type { MemberRefDto } from "./crm-types";
import type { ChannelType, ConversationStatus } from "./inbox-schemas";

export interface ChannelDto {
  id: string;
  type: ChannelType;
  name: string;
  /** Messages are not exchanged with a real provider */
  demo: boolean;
  status: "connected" | "error" | "disconnected";
  /** Public, non-secret: WhatsApp phone number id, page id, or widget key */
  externalId: string;
  /** Website chat: snippet to paste into the site */
  embedCode: string | null;
  greeting: string | null;
  createdAt: string;
}

export interface ConversationListItemDto {
  id: string;
  channel: { id: string; type: ChannelType; name: string; demo: boolean };
  contact: { id: string; name: string } | null;
  /** Display name when no CRM contact is linked (profile name, phone, "Ziyarətçi") */
  displayName: string;
  handle: string;
  status: ConversationStatus;
  assignee: MemberRefDto | null;
  departmentId: string | null;
  unreadCount: number;
  awaitingSince: string | null;
  lastMessageAt: string | null;
  lastMessage: { body: string; direction: MessageDirection } | null;
}

export type MessageDirection = "INBOUND" | "OUTBOUND" | "INTERNAL_NOTE";

export interface MessageDto {
  id: string;
  direction: MessageDirection;
  body: string;
  author: MemberRefDto | null;
  deliveryStatus: string | null;
  createdAt: string;
}

export interface ConversationDetailDto extends ConversationListItemDto {
  messages: MessageDto[];
  firstResponseMs: number | null;
  /** WhatsApp only: free-form replies are allowed for 24 h after the customer's last message */
  replyWindowEndsAt: string | null;
  can: { reply: boolean; assign: boolean };
}

export interface CannedResponseDto {
  id: string;
  shortcut: string;
  body: string;
}

export interface InboxMetricsDto {
  awaiting: number;
  longestWaitMin: number | null;
  avgFirstResponseMin: number | null;
  byMember: { member: MemberRefDto; conversations: number; avgFirstResponseMin: number | null }[];
  byChannel: { type: ChannelType; conversations: number }[];
}

/** Public widget API */
export interface WidgetConfigDto {
  companyName: string;
  channelName: string;
  greeting: string | null;
}

export interface WidgetMessageDto {
  id: string;
  from: "visitor" | "agent";
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface WidgetSendResponse {
  visitorToken: string;
  message: WidgetMessageDto;
}

/** Server-sent events on /v1/inbox/stream */
export type InboxEvent =
  | { type: "message"; conversationId: string; direction: MessageDirection }
  | { type: "conversation"; conversationId: string };
