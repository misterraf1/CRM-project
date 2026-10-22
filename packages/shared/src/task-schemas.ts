import { z } from "zod";

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "DONE", "CANCELED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof PRIORITIES)[number];

/** Supported subset of RFC 5545: FREQ=DAILY|WEEKLY|MONTHLY with optional INTERVAL=1..30 */
export const RECURRENCE = /^FREQ=(DAILY|WEEKLY|MONTHLY)(;INTERVAL=([1-9]|[12]\d|30))?$/;

const id = z.string().min(1).max(64);

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).nullish(),
  status: z.enum(TASK_STATUSES).default("TODO"),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  assigneeId: id.nullish(),
  dueAt: z.coerce.date().nullish(),
  projectId: id.nullish(),
  parentId: id.nullish(),
  contactId: id.nullish(),
  dealId: id.nullish(),
  recurrence: z.string().regex(RECURRENCE, "Unsupported recurrence").nullish(),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = taskCreateSchema
  .omit({ parentId: true })
  .partial()
  .extend({ position: z.number().finite().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

export const TASK_VIEWS = ["mine", "created", "all", "overdue"] as const;

export const taskListQuerySchema = z.object({
  view: z.enum(TASK_VIEWS).default("mine"),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: id.optional(),
  projectId: id.optional(),
  contactId: id.optional(),
  dealId: id.optional(),
  q: z.string().trim().max(100).optional(),
  /** Include finished (DONE/CANCELED) tasks; the board shows recent ones */
  includeDone: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const commentSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export const projectSchema = z.object({ name: z.string().trim().min(1).max(100), archived: z.boolean().optional() });
export type ProjectInput = z.infer<typeof projectSchema>;

export const teamStatsQuerySchema = z.object({ period: z.enum(["7d", "30d", "90d"]).default("30d") });
