import { z } from "zod";

export const CHANNEL_TYPES = ["WHATSAPP", "INSTAGRAM", "MESSENGER", "TELEGRAM", "WEBCHAT", "EMAIL"] as const;
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
    /** WhatsApp Business Account id: needed to load the approved message templates */
    wabaId: z.string().trim().regex(/^\d{5,30}$/).optional(),
  }),
  z.object({
    type: z.literal("TELEGRAM"),
    name: z.string().trim().min(1).max(80),
    demo: z.boolean().default(false),
    /** From @BotFather: 123456789:AA… */
    botToken: z.string().trim().regex(/^\d{5,15}:[\w-]{30,60}$/, "Invalid bot token").optional(),
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

/** WhatsApp business-initiated message: an approved template with its {{n}} values. */
export const templateMessageSchema = z.object({
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(15),
  params: z.array(z.string().trim().min(1).max(1024)).max(20).default([]),
});
export type TemplateMessageInput = z.infer<typeof templateMessageSchema>;

/** The customer's permission to receive messages we start (WhatsApp templates, campaigns). */
export const consentSchema = z.object({ status: z.enum(["opted_in", "opted_out"]).nullable() });

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

// ─── Business hours, away reply, SLA, operator status ────────────

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

/** Monday first. A closed day has open = false; times are the company's local time. */
export const inboxSettingsSchema = z.object({
  hours: z
    .array(z.object({ open: z.boolean(), start: clock, end: clock }).refine((d) => !d.open || d.start < d.end, "Start before end"))
    .length(7),
  /** Sent once per conversation (at most every 12 h) to customers who write outside business hours */
  autoReply: z.boolean(),
  awayMessage: z.string().trim().max(1000).nullable(),
  /** First-response target: conversations waiting longer are flagged */
  slaMinutes: z.number().int().min(5).max(10_080),
});
export type InboxSettings = z.infer<typeof inboxSettingsSchema>;

export const DEFAULT_INBOX_SETTINGS: InboxSettings = {
  hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: d < 5, start: "09:00", end: "18:00" })),
  autoReply: false,
  awayMessage: null,
  slaMinutes: 120,
};

export const PRESENCES = ["available", "away"] as const;
export type Presence = (typeof PRESENCES)[number];
export const presenceSchema = z.object({ presence: z.enum(PRESENCES) });
