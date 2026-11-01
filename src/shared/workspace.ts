import { z } from "zod";

/** Sidebar sections a company may hide; hidden means out of the menu only, no data is touched. */
export const HIDEABLE_MODULES = [
  "today",
  "inbox",
  "calendar",
  "chat",
  "deals",
  "sales",
  "orders",
  "cases",
  "campaigns",
  "targets",
  "team",
  "analytics",
  "automations",
  "files",
] as const;
export type HideableModule = (typeof HIDEABLE_MODULES)[number];

/** Words a company may rename (e.g. "Customers" → "Patients"), per interface language. */
export const TERM_KEYS = ["contact", "contacts", "newContact", "deal", "deals", "newDeal", "orders", "newOrder"] as const;
export type TermKey = (typeof TERM_KEYS)[number];
export type TermLang = "az" | "en" | "ru";
export type Terms = Partial<Record<TermLang, Partial<Record<TermKey, string>>>>;

const term = z.string().trim().max(40);
const termSet = z.object(Object.fromEntries(TERM_KEYS.map((k) => [k, term.optional()])) as Record<TermKey, z.ZodOptional<typeof term>>);

export const workspaceSchema = z.object({
  hiddenModules: z.array(z.enum(HIDEABLE_MODULES)).max(HIDEABLE_MODULES.length),
  terms: z.object({ az: termSet.optional(), en: termSet.optional(), ru: termSet.optional() }),
});
export type WorkspaceInput = z.infer<typeof workspaceSchema>;

export interface WorkspaceDto {
  hiddenModules: HideableModule[];
  terms: Terms;
}

/** Drops blank words so the interface falls back to its own. */
export function cleanTerms(terms: WorkspaceInput["terms"]): Terms {
  const out: Terms = {};
  for (const lang of ["az", "en", "ru"] as const) {
    const set = Object.fromEntries(Object.entries(terms[lang] ?? {}).filter(([, v]) => v)) as Partial<Record<TermKey, string>>;
    if (Object.keys(set).length) out[lang] = set;
  }
  return out;
}
