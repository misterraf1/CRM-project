import type { MemberRefDto } from "./crm-types";
import type { ChannelType, ConversationStatus } from "./inbox-schemas";

export interface WhatsAppTemplateDto {
  name: string;
  language: string;
  /** Body text with {{1}}, {{2}}… placeholders */
  body: string;
  params: number;
}

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
  /** Telegram: the bot's @username · WhatsApp: templates loaded / whether a WABA id is set */
  botUsername?: string | null;
  templates?: number;
  canSyncTemplates?: boolean;
  /** Email channel: the inbound webhook URL with its secret — returned only when the channel is created */
  inboundUrl?: string;
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
  /** Waiting longer than the company's first-response target */
  slaBreached: boolean;
  lastMessageAt: string | null;
  lastMessage: { body: string; direction: MessageDirection } | null;
}

export type MessageDirection = "INBOUND" | "OUTBOUND" | "INTERNAL_NOTE";

export interface MessageAttachmentDto {
  /** null when the file couldn't be stored (too large, storage full, provider error) */
  fileId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MessageDto {
  id: string;
  direction: MessageDirection;
  body: string;
  attachments: MessageAttachmentDto[];
  author: MemberRefDto | null;
  deliveryStatus: string | null;
  createdAt: string;
}

export interface ConversationDetailDto extends ConversationListItemDto {
  messages: MessageDto[];
  firstResponseMs: number | null;
  /** WhatsApp only: free-form replies are allowed for 24 h after the customer's last message */
  replyWindowEndsAt: string | null;
  /** WhatsApp: approved templates for writing outside the 24 h window */
  templates: WhatsAppTemplateDto[];
  /** The customer asked us to stop writing (STOP) or staff recorded it */
  optedOut: boolean;
  /** Channels that take files from us */
  canSendFiles: boolean;
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

/** AI assistant output for a conversation (never sent automatically) */
export interface AiTextDto {
  text: string;
  /** The model that answered (the next one takes over when a model is busy or out of quota) */
  model: string;
  usage: { used: number; limit: number };
}
