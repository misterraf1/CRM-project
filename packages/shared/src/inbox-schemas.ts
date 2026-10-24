import { z } from "zod";

export const CHANNEL_TYPES = ["WHATSAPP", "INSTAGRAM", "MESSENGER", "WEBCHAT", "EMAIL"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CONVERSATION_STATUSES = ["OPEN", "PENDING", "RESOLVED"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

const id = z.string().min(1).max(64);

/**
 * Connecting a channel. Meta channels need real credentials unless `demo` is set,
 * in which case nothing is ever sent to Meta and the UI labels the channel "Demo".
 */
export const channelCreateSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("WEBCHAT"), name: z.string().trim().min(1).max(80), greeting: z.string().trim().max(300).optional() }),
  z.object({
    type: z.literal("WHATSAPP"),
    name: z.string().trim().min(1).max(80),
    demo: z.boolean().default(false),
    phoneNumberId: z.string().trim().regex(/^\d{5,30}$/).optional(),
    accessToken: z.string().trim().min(20).max(1000).optional(),
  }),
  z.object({
    type: z.enum(["INSTAGRAM", "MESSENGER"]),
    name: z.string().trim().min(1).max(80),
    demo: z.boolean().default(false),
    /** Facebook Page id (Messenger) or Instagram professional account id */
    accountId: z.string().trim().regex(/^\d{5,30}$/).optional(),
    accessToken: z.string().trim().min(20).max(1000).optional(),
  }),
  z.object({
    type: z.literal("EMAIL"),
    name: z.string().trim().min(1).max(80),
    demo: z.boolean().default(false),
    /** The support address customers write to; replies are sent from it */
    address: z.string().trim().toLowerCase().email().max(254),
  }),
]);
export type ChannelCreateInput = z.infer<typeof channelCreateSchema>;

export const conversationListQuerySchema = z.object({
  status: z.enum([...CONVERSATION_STATUSES, "ALL"]).default("OPEN"),
  assignee: z.enum(["me", "unassigned", "all"]).default("all"),
  channelId: id.optional(),
  contactId: id.optional(),
  q: z.string().trim().max(100).optional(),
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4096),
  /** Internal notes are visible to the team only and are never sent to the customer */
  internal: z.boolean().default(false),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const conversationUpdateSchema = z
  .object({
    status: z.enum(CONVERSATION_STATUSES),
    assigneeId: id.nullable(),
    departmentId: id.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type ConversationUpdateInput = z.infer<typeof conversationUpdateSchema>;

export const linkContactSchema = z.object({
  /** Existing CRM contact to link; omitted = create one from the conversation */
  contactId: id.optional(),
  name: z.string().trim().min(1).max(150).optional(),
});

export const cannedResponseSchema = z.object({
  shortcut: z
    .string()
    .trim()
    .regex(/^\/[\p{L}\p{N}_-]{1,30}$/u, "Shortcut must look like /salam"),
  body: z.string().trim().min(1).max(2000),
});
export type CannedResponseInput = z.infer<typeof cannedResponseSchema>;

export const simulateInboundSchema = z.object({
  from: z.string().trim().min(1).max(80),
  name: z.string().trim().max(100).optional(),
  body: z.string().trim().min(1).max(4096),
});
export type SimulateInboundInput = z.infer<typeof simulateInboundSchema>;

/** Public website-widget calls (no login). */
export const widgetMessageSchema = z.object({
  visitorToken: z.string().min(20).max(100).optional(),
  body: z.string().trim().min(1).max(2000),
  name: z.string().trim().max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});
export type WidgetMessageInput = z.infer<typeof widgetMessageSchema>;

export const inboxMetricsQuerySchema = z.object({ period: z.enum(["7d", "30d", "90d"]).default("30d") });
