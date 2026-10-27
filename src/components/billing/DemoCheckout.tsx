"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { InvoiceDto } from "@axis/shared";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

export function DemoCheckout({ invoiceId }: { invoiceId: string }) {
  const { t } = useI18n();
  const k = t.checkout;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const pay = (outcome: "success" | "declined") =>
    startTransition(async () => {
      setError(undefined);
      const res = await api<InvoiceDto>(`/billing/demo/invoices/${invoiceId}/complete`, "POST", { outcome });
      if (!res.ok) return setError(errorMessage(t, res.code));
      if (res.data.status === "PAID") router.push("/settings/billing?paid=1");
      else setError(k.declined);
    });

  return (
    <div className="mt-5 space-y-3">
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-xs text-fg-subtle">{k.card}</p>
        <p className="mt-1 font-mono text-sm tracking-wider">4242 4242 4242 4242 · 12/30 · 123</p>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={pending} onClick={() => pay("success")} className="btn-primary">
          {k.paySuccess}
        </button>
        <button type="button" disabled={pending} onClick={() => pay("declined")} className="btn-danger border border-danger/30">
          {k.payDeclined}
        </button>
      </div>
    </div>
  );
}
