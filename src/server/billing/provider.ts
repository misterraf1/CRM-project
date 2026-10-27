import type { Invoice, Subscription } from "../db/models";
import { config } from "../config";
import { randomToken } from "../common/ids";

export interface ChargeResult {
  ok: boolean;
  providerRef: string;
  failureCode?: string;
}

/**
 * Payment provider boundary. Real providers (Payriff, Epoint) implement the same
 * two operations: a hosted checkout for the customer's first/explicit payment, and
 * charging the saved card for renewals. Card data never touches our servers.
 */
export interface PaymentProvider {
  readonly name: "demo";
  checkoutUrl(invoice: Invoice): string;
  chargeSaved(subscription: Subscription, invoice: Invoice): Promise<ChargeResult>;
}

/**
 * DEMO provider: no money moves. The checkout is a page in our own web app labelled
 * "DEMO", where the user chooses success or a declined card; renewals succeed unless
 * the "next charge fails" switch is on (to try the dunning flow).
 */
export class DemoPaymentProvider implements PaymentProvider {
  readonly name = "demo" as const;

  checkoutUrl(invoice: Invoice) {
    return `${config().WEB_ORIGIN}/billing/checkout/${invoice.id}`;
  }

  async chargeSaved(subscription: Subscription): Promise<ChargeResult> {
    if (!subscription.paymentMethod) return { ok: false, providerRef: `demo_${randomToken(8)}`, failureCode: "no_payment_method" };
    if (subscription.demoNextChargeFails) return { ok: false, providerRef: `demo_${randomToken(8)}`, failureCode: "card_declined" };
    return { ok: true, providerRef: `demo_${randomToken(8)}` };
  }
}
