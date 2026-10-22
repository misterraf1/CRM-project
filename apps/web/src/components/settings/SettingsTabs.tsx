"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";

export function SettingsTabs() {
  const { t } = useI18n();
  const pathname = usePathname();
  const tabs = [
    { href: "/settings/members", label: t.members.title },
    { href: "/settings/channels", label: t.channels.title },
  ];
  return (
    <nav aria-label={t.nav.settings} className="mb-5 flex gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? "page" : undefined}
          className={clsx(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
            pathname === tab.href ? "border-accent text-accent" : "border-transparent text-fg-muted hover:text-fg",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
