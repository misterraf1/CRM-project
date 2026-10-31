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
    { href: "/settings/roles", label: t.roles.title },
    { href: "/settings/channels", label: t.channels.title },
    { href: "/settings/crm", label: t.crmSettings.tab },
    { href: "/settings/billing", label: t.billing.title },
    { href: "/settings/forms", label: t.forms.tab },
    { href: "/settings/integrations", label: t.integrations.tab },
    { href: "/settings/notifications", label: t.notificationPrefs.title },
    { href: "/settings/security", label: t.security.title },
  ];
  return (
    <nav aria-label={t.nav.settings} className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname.startsWith(tab.href) ? "page" : undefined}
          className={clsx(
            "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            pathname.startsWith(tab.href) ? "border-accent text-accent" : "border-transparent text-fg-muted hover:text-fg",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
