import { z } from "zod";

export const BUSINESS_TEMPLATES_KEYS = [
  "retail",
  "services",
  "clinic",
  "beauty",
  "realestate",
  "education",
  "travel",
  "auto",
  "construction",
  "production",
  "logistics",
  "restaurant",
  "legal",
  "agency",
  "hosting",
] as const;
export type BusinessTemplateKey = (typeof BUSINESS_TEMPLATES_KEYS)[number];

/** `setup`: the first-run choice — also sets the menu and the trade's words */
export const applyTemplateSchema = z.object({ key: z.enum(BUSINESS_TEMPLATES_KEYS), makeDefault: z.boolean().default(false), setup: z.boolean().default(false) });

/** What a template brings, shown before it is applied */
export interface TemplatePreviewDto {
  key: BusinessTemplateKey;
  pipeline: string;
  stages: string[];
  fields: string[];
  products: string[];
  orderSteps: string[];
  hide: import("./workspace").HideableModule[];
  terms: Partial<Record<import("./workspace").TermKey, string>>;
}

export const ONBOARDING_STEPS = ["profile", "team", "channel", "contact", "deal", "quote", "template"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingDto {
  steps: { key: OnboardingStep; done: boolean }[];
  dismissed: boolean;
  /** Sample records are in the base (removable in one go) */
  demo: boolean;
  appliedTemplates: BusinessTemplateKey[];
}

export interface TemplateResultDto {
  pipelineId: string;
  fields: number;
  products: number;
  automations: number;
}
