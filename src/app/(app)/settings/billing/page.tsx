import type { Metadata } from "next";
import { BillingManager } from "@/components/billing/BillingManager";
import { getBilling, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Billing" };

type Props = { searchParams: Promise<{ paid?: string }> };

export default async function BillingPage({ searchParams }: Props) {
  const [{ t }, me, { paid }] = await Promise.all([getI18n(), getSession(), searchParams]);
  if (!me.permissions.includes("billing.manage")) {
    return <p className="card p-6 text-sm text-fg-muted">{t.billing.ownerOnly}</p>;
  }
  return <BillingManager data={await getBilling()} paid={paid === "1"} />;
}
