import type { Invoice, Payment } from "../db/models";
import type { InvoiceDto, InvoiceKind, InvoiceLineDto } from "@/shared";
import type { Tx } from "../db/database";

/** Sequential, gap-free per year across the platform: AX-2026-000001. */
export async function nextInvoiceNumber(tx: Tx, now = new Date()) {
  const year = now.getUTCFullYear();
  const counter = await tx.counter.upsert({ id: `invoice:${year}` }, { $inc: { value: 1 } }, { id: `invoice:${year}`, value: 1 });
  return `AX-${year}-${String(counter.value).padStart(6, "0")}`;
}

/** Invoices with their payment attempts. */
export async function withPayments(tx: Tx, invoices: Invoice[]): Promise<(Invoice & { payments: Payment[] })[]> {
  const payments = invoices.length ? await tx.payment.find({ invoiceId: { $in: invoices.map((i) => i.id) } }, { sort: { createdAt: 1 } }) : [];
  return invoices.map((i) => ({ ...i, payments: payments.filter((p) => p.invoiceId === i.id) }));
}

export function toInvoiceDto(i: Invoice & { payments?: Payment[] }): InvoiceDto {
  return {
    id: i.id,
    number: i.number,
    kind: i.kind as InvoiceKind,
    status: i.status,
    amount: i.amount,
    currency: i.currency,
    periodStart: i.periodStart.toISOString(),
    periodEnd: i.periodEnd.toISOString(),
    lines: (i.lines ?? []) as unknown as InvoiceLineDto[],
    paidAt: i.paidAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
    payments: (i.payments ?? []).map((p) => ({ provider: p.provider, status: p.status, failureCode: p.failureCode, createdAt: p.createdAt.toISOString() })),
  };
}

/** What paying an invoice applies to the subscription (stored on the invoice). */
export interface InvoiceApply {
  planId?: string;
  interval?: "MONTH" | "YEAR";
  /** Start a fresh period when paid (first payment, interval change, reactivation) */
  newPeriod?: boolean;
  /** Renewal: the exact period this invoice pays for */
  periodStart?: string;
  periodEnd?: string;
  extraSeats?: number;
  extraStorageMb?: number;
}
