import { z } from "zod";

/** Lists that can have saved views */
export const VIEW_ENTITIES = ["contacts", "deals", "tasks"] as const;
export type ViewEntity = (typeof VIEW_ENTITIES)[number];

export const savedViewCreateSchema = z.object({
  entity: z.enum(VIEW_ENTITIES),
  name: z.string().trim().min(1).max(60),
  /** The list's query string (filters, tab, sort) without the page */
  query: z.string().max(2000),
  /** Visible to the whole team (needs crm.configure) */
  shared: z.boolean().default(false),
});

export interface SavedViewDto {
  id: string;
  name: string;
  query: string;
  shared: boolean;
  mine: boolean;
}
