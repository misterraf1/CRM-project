import type { RenewalStatus } from "@/shared";
import type { Metadata } from "next";
import { RenewalsList } from "@/components/sales/RenewalsList";
import { SalesTabs } from "@/components/sales/SalesTabs";
import { getRenewals, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Renewals" };

type Props = { searchParams: Promise<{ status?: string }> };

export default async function RenewalsPage({ searchParams }: Props) {
  const [{ t }, me, sp] = await Promise.all([getI18n(), getSession(), searchParams]);
  const status: RenewalStatus = sp.status === "renewed" || sp.status === "lost" ? sp.status : "upcoming";
  const renewals = await getRenewals(status);
  return (
    <div>
      <SalesTabs invoices={me.permissions.includes("finance.view") || me.permissions.includes("invoices.manage")} />
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t.renewals.title}</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-fg-muted">{t.renewals.subtitle}</p>
      </div>
      <RenewalsList key={status} renewals={renewals} status={status} />
    </div>
  );
}
