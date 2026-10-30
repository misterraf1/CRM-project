import { z } from "zod";
import { CURRENCIES } from "./crm-settings";

// ─── Products, quotes and invoices ──────────────────────────────
// Money is in minor units (qəpik); rates (discount, VAT) in basis points: 1800 = 18%.

export const DOC_KINDS = ["quote", "invoice"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Stored status. "Expired" (quote) and "overdue" / "partly paid" (invoice) are derived on read. */
export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected"] as const;
export const INVOICE_STATUSES = ["draft", "issued", "paid", "void"] as const;
export type DocStatus = (typeof QUOTE_STATUSES)[number] | (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ["transfer", "cash", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DOC_LIMITS = { lines: 100 } as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();
const rate = z.number().int().min(0).max(10_000);
const money = z.number().int().min(0).max(100_000_000_000);
const day = z.string().date();

export const productSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: text(60),
  description: text(1000),
  unit: z.string().trim().min(1).max(20).default("ədəd"),
  price: money,
  currency: z.enum(CURRENCIES),
  taxBp: rate.default(0),
  active: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productSchema>;

export const docLineSchema = z.object({
  productId: z.string().min(1).max(64).nullish(),
  name: z.string().trim().min(1).max(200),
  description: text(500),
  /** Up to 3 decimals (1.5 hours, 0.25 kg) */
  quantity: z
    .number()
    .positive()
    .max(1_000_000)
    .refine((q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, "At most 3 decimals"),
  unit: z.string().trim().min(1).max(20),
  unitPrice: money,
  discountBp: rate.default(0),
  taxBp: rate.default(0),
});
export type DocLineInput = z.infer<typeof docLineSchema>;

export const docInputSchema = z.object({
  contactId: z.string().min(1).max(64),
  dealId: z.string().min(1).max(64).nullish(),
  currency: z.enum(CURRENCIES),
  /** Quote: valid until · invoice: payment due */
  dueDate: day.nullish(),
  notes: text(2000),
  lines: z.array(docLineSchema).min(1).max(DOC_LIMITS.lines),
});
export type DocInput = z.infer<typeof docInputSchema>;

export const docListQuerySchema = z.object({
  kind: z.enum(DOC_KINDS),
  status: z.string().max(20).optional(),
  dealId: z.string().max(64).optional(),
  contactId: z.string().max(64).optional(),
  q: z.string().trim().max(100).optional(),
});

export const docSendSchema = z.object({
  /** Defaults to the customer's email */
  to: z.string().trim().toLowerCase().email().max(254).optional(),
});

export const paymentSchema = z.object({
  amount: z.number().int().min(1).max(100_000_000_000),
  method: z.enum(PAYMENT_METHODS),
  paidOn: day,
  reference: text(120),
  note: text(500),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

/** The customer's answer on the public quote page. */
export const quoteResponseSchema = z.object({
  decision: z.enum(["accept", "reject"]),
  name: z.string().trim().min(2).max(100),
  comment: text(1000),
});

/** Company details printed on every document. */
export const docSettingsSchema = z.object({
  legalName: text(200),
  taxId: text(40),
  address: text(300),
  bankDetails: text(1000),
  /** Default terms shown under every document */
  terms: text(2000),
});
export type DocSettings = z.infer<typeof docSettingsSchema>;

// ─── Totals (the same arithmetic in the browser and the API) ───

export interface LineTotals {
  net: number;
  discount: number;
  tax: number;
  total: number;
}

export function lineTotals(l: Pick<DocLineInput, "quantity" | "unitPrice" | "discountBp" | "taxBp">): LineTotals {
  const net = Math.round(l.quantity * l.unitPrice);
  const discount = Math.round((net * (l.discountBp ?? 0)) / 10_000);
  const tax = Math.round(((net - discount) * (l.taxBp ?? 0)) / 10_000);
  return { net, discount, tax, total: net - discount + tax };
}

export function docTotals(lines: Pick<DocLineInput, "quantity" | "unitPrice" | "discountBp" | "taxBp">[]) {
  const each = lines.map(lineTotals);
  const sum = (k: keyof LineTotals) => each.reduce((a, t) => a + t[k], 0);
  return { lines: each, subtotal: sum("net"), discountTotal: sum("discount"), taxTotal: sum("tax"), total: sum("total") };
}

// ─── DTOs ───────────────────────────────────────────────────────

export interface ProductDto {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string;
  price: number;
  currency: string;
  taxBp: number;
  active: boolean;
}

export interface DocLineDto extends LineTotals {
  productId: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountBp: number;
  taxBp: number;
}

export interface DocPaymentDto {
  id: string;
  amount: number;
  method: PaymentMethod;
  paidOn: string;
  reference: string | null;
  note: string | null;
  recordedBy: string | null;
  createdAt: string;
}

/** What the list and the deal page show. */
export interface DocSummaryDto {
  id: string;
  kind: DocKind;
  /** null while an invoice is a draft (numbers are given when it is issued) */
  number: string | null;
  status: DocStatus;
  /** Derived: quote past its date · invoice past due · invoice partly paid */
  expired: boolean;
  overdue: boolean;
  contact: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  owner: { id: string; name: string } | null;
  currency: string;
  total: number;
  paidAmount: number;
  dueDate: string | null;
  createdAt: string;
}

export interface DocDto extends DocSummaryDto {
  lines: DocLineDto[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  notes: string | null;
  issueDate: string | null;
  sentAt: string | null;
  sourceId: string | null;
  /** Invoices made from this quote */
  invoices: { id: string; number: string | null; status: DocStatus }[];
  response: { decision: "accept" | "reject"; name: string; comment: string | null; at: string } | null;
  payments: DocPaymentDto[];
  /** Whether a customer link exists (the link itself is only shown when created) */
  shared: boolean;
}

export interface DocShareResponse {
  doc: DocDto;
  /** Path of the customer page, e.g. /p/tnt_x.secret */
  publicPath: string;
  emailDelivery: "queued" | "not_configured" | "no_email" | "not_sent";
}

/** The customer's view: no internal data (owner, payments' authors, deal). */
export interface PublicDocDto {
  kind: DocKind;
  number: string | null;
  status: DocStatus;
  expired: boolean;
  company: { name: string } & DocSettings;
  customer: { name: string; email: string | null; phone: string | null; companyName: string | null };
  currency: string;
  lines: DocLineDto[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paidAmount: number;
  issueDate: string | null;
  dueDate: string | null;
  notes: string | null;
  response: { decision: "accept" | "reject"; name: string; at: string } | null;
  locale: string;
}
