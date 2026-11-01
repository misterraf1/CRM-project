import { z } from "zod";

/** What a public API key may touch: read = GET, write = everything else. */
export const API_SCOPES = ["contacts.read", "contacts.write", "deals.read", "deals.write", "tasks.read", "tasks.write", "products.read", "products.write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** API paths per scope area (anything else is closed to keys: sign-in, settings, members, billing …) */
export const API_SCOPE_PATHS: Record<string, readonly string[]> = {
  contacts: ["/v1/contacts", "/v1/fields"],
  deals: ["/v1/deals", "/v1/pipelines"],
  tasks: ["/v1/tasks"],
  products: ["/v1/products"],
};

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
});

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdBy: { id: string; name: string } | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** The key itself is returned once, at creation */
export interface ApiKeyCreatedDto {
  key: string;
  apiKey: ApiKeyDto;
}

/** Events an outside system can be told about */
export const WEBHOOK_EVENTS = [
  "contact.created",
  "deal.created",
  "deal.stage_changed",
  "conversation.created",
  "task.overdue",
  "quote.accepted",
  "invoice.paid",
  "order.done",
  "case.created",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const url = z.string().trim().url().max(500);

export const webhookCreateSchema = z.object({
  url,
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
  description: z.string().trim().max(200).optional(),
});

export const webhookUpdateSchema = z.object({
  url: url.optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  active: z.boolean().optional(),
});

export interface WebhookEndpointDto {
  id: string;
  url: string;
  events: WebhookEvent[];
  description: string | null;
  active: boolean;
  /** For checking the X-Axis-Signature header */
  secret: string;
  lastDeliveryAt: string | null;
  lastStatus: "success" | "failed" | null;
  createdAt: string;
}

export interface WebhookDeliveryDto {
  id: string;
  event: string;
  status: "pending" | "processing" | "success" | "failed";
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
}
