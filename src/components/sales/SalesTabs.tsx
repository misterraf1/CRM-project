"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";

/** Quotes · invoices (finance) · products. */
export function SalesTabs({ invoices }: { invoices: boolean }) {
  const { t } = useI18n();
  const k = t.sales;
  const pathname = usePathname();
  const kind = useSearchParams().get("kind") ?? "quote";
  const tabs = [
    { href: "/sales?kind=quote", label: k.quotes, active: pathname === "/sales" && kind === "quote" },
    ...(invoices ? [{ href: "/sales?kind=invoice", label: k.invoices, active: pathname === "/sales" && kind === "invoice" }] : []),
    { href: "/sales/products", label: k.products, active: pathname.startsWith("/sales/products") },
    { href: "/sales/renewals", label: t.renewals.tab, active: pathname.startsWith("/sales/renewals") },
  ];
  return (
    <nav aria-label={t.nav.sales} className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={clsx(
            "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            tab.active ? "border-accent text-accent" : "border-transparent text-fg-muted hover:text-fg",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
