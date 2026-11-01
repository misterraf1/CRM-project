import { z } from "zod";
import { FIELD_TYPES, type CustomFieldValues, type FieldType } from "./crm-settings";

/** Icons a custom section can have in the menu */
export const OBJECT_ICONS = ["box", "car", "home", "book", "briefcase", "wrench", "calendar", "tag", "truck", "heart"] as const;
export type ObjectIcon = (typeof OBJECT_ICONS)[number];

const option = z.string().trim().min(1).max(60);
const objectField = z
  .object({
    /** Existing field; omitted for a new one */
    id: z.string().min(1).max(64).optional(),
    label: z.string().trim().min(1).max(60),
    type: z.enum(FIELD_TYPES),
    options: z.array(option).max(50).default([]),
    required: z.boolean().default(false),
  })
  .refine((v) => !["select", "multiselect"].includes(v.type) || v.options.length > 0, { message: "Options required", path: ["options"] });

export const objectCreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  singular: z.string().trim().min(1).max(40),
  icon: z.enum(OBJECT_ICONS).default("box"),
  fields: z.array(objectField).max(30).default([]),
});

export const objectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  singular: z.string().trim().min(1).max(40).optional(),
  icon: z.enum(OBJECT_ICONS).optional(),
  /** The full field list (a field left out is archived: its values stay on the records) */
  fields: z.array(objectField).max(30).optional(),
});

export interface ObjectFieldDto {
  id: string;
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
}

export interface CustomObjectDto {
  id: string;
  name: string;
  singular: string;
  icon: ObjectIcon;
  fields: ObjectFieldDto[];
  records: number;
}

export const recordInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  values: z.record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string().max(60)).max(50), z.null()])).default({}),
  contactId: z.string().max(64).nullable().optional(),
});

export const recordListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  contactId: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export interface CustomRecordDto {
  id: string;
  objectId: string;
  title: string;
  values: CustomFieldValues;
  contact: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}
