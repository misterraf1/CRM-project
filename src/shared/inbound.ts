import { z } from "zod";

/**
 * Incoming integrations: each gets its own secret address that the outside system
 * calls. No keys from us are needed — the company pastes the address there.
 *  - leads: website forms (Tilda, WordPress / Contact Form 7, Elementor, any form builder)
 *  - google_ads: Google Ads lead form extensions
 *  - shopify, woocommerce: new orders (signed with the shop's webhook secret)
 *  - calls: IP telephony call events (Zadarma, Asterisk/FreePBX or any PBX that can call a URL)
 */
export const INBOUND_KINDS = ["leads", "google_ads", "shopify", "woocommerce", "calls"] as const;
export type InboundKind = (typeof INBOUND_KINDS)[number];

/** Kinds that check a signature or key with a secret the company copies from the other side */
export const INBOUND_NEEDS_SECRET: readonly InboundKind[] = ["google_ads", "shopify", "woocommerce"];

export const inboundCreateSchema = z.object({
  kind: z.enum(INBOUND_KINDS),
  name: z.string().trim().min(1).max(80),
  secret: z.string().trim().max(200).optional(),
  /** Who new customers and missed calls go to (default: the company owner) */
  ownerId: z.string().max(64).nullable().optional(),
  /** leads / google_ads: open a deal for each new lead */
  createDeal: z.boolean().default(false),
});

export const inboundUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  secret: z.string().trim().max(200).optional(),
  ownerId: z.string().max(64).nullable().optional(),
  createDeal: z.boolean().optional(),
  active: z.boolean().optional(),
});

export interface InboundHookDto {
  id: string;
  kind: InboundKind;
  name: string;
  /** The address to paste into the other system */
  url: string;
  hasSecret: boolean;
  ownerId: string | null;
  createDeal: boolean;
  active: boolean;
  received: number;
  lastReceivedAt: string | null;
  lastError: string | null;
}
