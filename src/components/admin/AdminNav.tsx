"use client";

import clsx from "clsx";
import { Activity, Building2, LayoutDashboard, LifeBuoy, Package, Receipt, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";

const ITEMS = [
  { key: "overview", href: "/admin", icon: LayoutDashboard },
  { key: "tenants", href: "/admin/tenants", icon: Building2 },
  { key: "plans", href: "/admin/plans", icon: Package },
  { key: "billing", href: "/admin/billing", icon: Receipt },
  { key: "expenses", href: "/admin/expenses", icon: Wallet, superOnly: true },
  { key: "tickets", href: "/admin/tickets", icon: LifeBuoy },
  { key: "system", href: "/admin/system", icon: Activity },
  { key: "security", href: "/admin/security", icon: ShieldCheck },
] as const;

export function AdminNav({ superAdmin }: { superAdmin: boolean }) {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <nav aria-label={t.admin.title} className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {ITEMS.filter((i) => superAdmin || !("superOnly" in i)).map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm",
              active ? "bg-accent-soft font-medium text-accent" : "text-fg-muted hover:bg-muted hover:text-fg",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden />
            {t.admin.nav[item.key]}
          </Link>
        );
      })}
    </nav>
  );
}
