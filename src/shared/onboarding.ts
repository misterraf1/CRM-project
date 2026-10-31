import { z } from "zod";

export const BUSINESS_TEMPLATES_KEYS = ["production", "agency", "hosting", "services"] as const;
export type BusinessTemplateKey = (typeof BUSINESS_TEMPLATES_KEYS)[number];

export const applyTemplateSchema = z.object({ key: z.enum(BUSINESS_TEMPLATES_KEYS), makeDefault: z.boolean().default(false) });

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
