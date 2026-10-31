import { z } from "zod";
import { CONTACT_SOURCES } from "./crm-schemas";
import { CHANNEL_TYPES } from "./inbox-schemas";

export const AUTOMATION_TRIGGERS = [
  "deal.created",
  "deal.stage_changed",
  "contact.created",
  "conversation.created",
  "task.overdue",
  "quote.accepted",
  "invoice.paid",
  "order.done",
  /** No activity on the contact for `inactiveDays` (checked every few minutes) */
  "contact.inactive",
  /** A customer has waited past the company's reply target (SLA) */
  "conversation.unanswered",
  /** A customer complaint / service request was opened */
  "case.created",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

const id = z.string().trim().min(1).max(40);

/** All optional; which ones apply depends on the trigger (the API ignores the rest). */
export const automationConditionsSchema = z
  .object({
    /** deal.*: only deals in this pipeline / entering (stage_changed) or created in (created) this stage */
    stageId: id.optional(),
    minAmount: z.number().int().min(0).max(1_000_000_000).optional(),
    /** contact.created */
    source: z.enum(CONTACT_SOURCES).optional(),
    /** conversation.created */
    channelType: z.enum(CHANNEL_TYPES).optional(),
    /** contact.inactive: days without activity (default 30) */
    inactiveDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();
export type AutomationConditions = z.infer<typeof automationConditionsSchema>;

/** "owner" = the record's owner / assignee; otherwise a membership id */
const recipient = z.union([z.literal("owner"), z.literal("managers"), id]);

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_task"),
    title: z.string().trim().min(2).max(200),
    dueInDays: z.number().int().min(0).max(365),
    assignee: z.union([z.literal("owner"), id]),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  }),
  z.object({
    type: z.literal("notify"),
    recipient,
    message: z.string().trim().min(2).max(300),
  }),
  z.object({
    type: z.literal("assign"),
    /** One member, or rotate through several */
    memberIds: z.array(id).min(1).max(50),
  }),
  z.object({
    /** The related deal moves to this stage (same pipeline; open or won) */
    type: z.literal("move_stage"),
    stageId: id,
  }),
  z.object({
    /** Email to the related customer ({name} and {title} are filled in) */
    type: z.literal("send_email"),
    subject: z.string().trim().min(2).max(200),
    body: z.string().trim().min(2).max(5000),
  }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const automationRuleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: automationConditionsSchema.default({}),
  actions: z.array(automationActionSchema).min(1).max(5),
  enabled: z.boolean().default(true),
});
export type AutomationRuleInput = z.infer<typeof automationRuleSchema>;

export const automationRuleUpdateSchema = automationRuleSchema.partial();

export interface AutomationRuleDto {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationConditions;
  actions: AutomationAction[];
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AutomationRunDto {
  id: string;
  status: "success" | "skipped" | "failed";
  detail: string | null;
  createdAt: string;
}
