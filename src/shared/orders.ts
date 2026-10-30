import { z } from "zod";

// ─── Orders: what happens after the sale ─────────────────────────

/** "new" until a step is done, "in_progress" after, "done" when every step is; "canceled" by hand. */
export const ORDER_STATUSES = ["new", "in_progress", "done", "canceled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_LIMITS = { steps: 30 } as const;

const day = z.string().date();
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();

export const orderStepInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  assigneeId: z.string().min(1).max(64).nullish(),
  dueDate: day.nullish(),
});

export const orderCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  contactId: z.string().min(1).max(64),
  dealId: z.string().min(1).max(64).nullish(),
  /** The quote the order fulfils (its total and currency are taken over) */
  quoteId: z.string().min(1).max(64).nullish(),
  dueDate: day.nullish(),
  deliveryDate: day.nullish(),
  notes: text(2000),
  steps: z.array(orderStepInputSchema).max(ORDER_LIMITS.steps).default([]),
});
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    dueDate: day.nullable(),
    deliveryDate: day.nullable(),
    notes: text(2000),
    ownerId: z.string().min(1).max(64),
    /** Cancel or reopen; the other statuses follow the steps */
    canceled: z.boolean(),
  })
  .partial();

export const orderStepUpdateSchema = orderStepInputSchema.partial().extend({ done: z.boolean().optional() });

export const orderListQuerySchema = z.object({
  status: z.enum([...ORDER_STATUSES, "overdue"] as [string, ...string[]]).optional(),
  dealId: z.string().max(64).optional(),
  contactId: z.string().max(64).optional(),
});

export interface OrderStepDto {
  id: string;
  title: string;
  assignee: { id: string; name: string } | null;
  dueDate: string | null;
  doneAt: string | null;
  doneBy: string | null;
  overdue: boolean;
}

export interface OrderSummaryDto {
  id: string;
  number: string;
  title: string;
  status: OrderStatus;
  /** Past its completion date and not done */
  overdue: boolean;
  contact: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  owner: { id: string; name: string } | null;
  progress: { done: number; total: number };
  currency: string;
  total: number;
  dueDate: string | null;
  createdAt: string;
}

export interface OrderDto extends OrderSummaryDto {
  quote: { id: string; number: string | null } | null;
  deliveryDate: string | null;
  notes: string | null;
  steps: OrderStepDto[];
  completedAt: string | null;
}

/** What the customer sees under their quote: progress only, no names. */
export interface PublicOrderDto {
  number: string;
  status: OrderStatus;
  deliveryDate: string | null;
  dueDate: string | null;
  steps: { title: string; done: boolean; dueDate: string | null }[];
}
