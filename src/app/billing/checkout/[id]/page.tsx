import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DemoCheckout } from "@/components/billing/DemoCheckout";
import { getInvoice } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { invoiceLineText } from "@/lib/billing";
import { formatMoney } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

/** DEMO hosted checkout: stands in for the payment provider's page. */
export default async function CheckoutPage({ params }: Props) {
  const { id } = await params;
  const { t, locale } = await getI18n();
  const k = t.checkout;
  const inv = await getInvoice(id).catch((e) => {
    if (e instanceof ApiRequestError) return null;
    throw e;
  });
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-start gap-2 rounded-xl border-2 border-dashed border-warning bg-warning/10 p-4 text-warning" role="note">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="text-sm font-bold">{k.demoTitle}</p>
            <p className="mt-1 text-xs">{k.demoBody}</p>
          </div>
        </div>
        <section className="card p-6">
          <h1 className="text-lg font-semibold">{k.title}</h1>
          {!inv || inv.status !== "OPEN" ? (
            <p className="mt-3 text-sm text-fg-muted">{k.notPayable}</p>
          ) : (
            <>
              <p className="mt-0.5 font-mono text-xs text-fg-subtle">{interpolate(k.invoice, { number: inv.number })}</p>
              <ul className="mt-4 space-y-1.5 text-sm">
                {inv.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="text-fg-muted">{invoiceLineText(l, t)}</span>
                    <span className="tabular">{formatMoney(l.amount, locale, inv.currency)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 flex justify-between border-t border-border pt-3 text-base font-semibold">
                <span>{k.total}</span>
                <span className="tabular">{formatMoney(inv.amount, locale, inv.currency)}</span>
              </p>
              <DemoCheckout invoiceId={inv.id} />
            </>
          )}
          <Link href="/settings/billing" className="mt-4 inline-block text-xs text-fg-muted hover:text-fg">
            ← {k.back}
          </Link>
        </section>
      </div>
    </main>
  );
}
