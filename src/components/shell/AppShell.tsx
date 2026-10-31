"use client";

import { CommandPalette } from "./CommandPalette";
import clsx from "clsx";
import { AlertTriangle, Menu, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { MeResponse } from "@/shared";
import type { ShellSummary } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { interpolate } from "@/lib/i18n/locales";
import { NAV_GROUPS, type NavItem } from "@/lib/navigation";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { NotificationBell } from "./NotificationBell";
import { QuickCreate } from "./QuickCreate";
import { SkipLink } from "@/components/ui/SkipLink";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

const COLLAPSED_KEY = "axis-sidebar-collapsed";

export function AppShell({ session, summary, children }: { session: MeResponse; summary: ShellSummary; children: ReactNode }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      /* default: expanded */
    }
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, prev ? "0" : "1");
      } catch {
        /* preference just won't persist */
      }
      return !prev;
    });

  return (
    <div className="min-h-screen">
      <SkipLink label={t.shell.skipToContent} />
      <Sidebar
        session={session}
        summary={summary}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className={clsx("transition-[padding] duration-200 print:!pl-0", collapsed ? "lg:pl-[68px]" : "lg:pl-60")}>
        <header className="sticky top-0 z-20 flex print:hidden h-14 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur-md lg:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:bg-muted lg:hidden"
            aria-label={t.shell.openMenu}
          >
            <Menu className="h-5 w-5" />
          </button>
          <Section />
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <CommandPalette />
            <QuickCreate permissions={session.permissions} />
            <NotificationBell unread={summary.unreadNotifications} />
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <SubscriptionBanner session={session} />
        <main id="main" tabIndex={-1} className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 outline-none lg:px-6 lg:pb-6 print:p-0">{children}</main>
      </div>
      <BottomNav session={session} summary={summary} onMore={() => setMobileOpen(true)} />
    </div>
  );
}

/** Payment problems and a scheduled end are visible on every page, not only in settings. */
function SubscriptionBanner({ session }: { session: MeResponse }) {
  const { t, locale } = useI18n();
  const b = t.billing.banners;
  const sub = session.subscription;
  const date = (iso: string | null) => (iso ? formatDate(iso, locale, "long") : "");
  const text =
    sub.status === "PAST_DUE"
      ? interpolate(b.PAST_DUE, { date: date(sub.graceEndsAt) })
      : sub.status === "SUSPENDED" || sub.status === "CANCELED"
        ? b[sub.status]
        : sub.cancelAtPeriodEnd
          ? interpolate(b.cancelAtPeriodEnd, { date: date(sub.currentPeriodEnd) })
          : null;
  if (!text) return null;
  const severe = sub.status !== "ACTIVE" && sub.status !== "TRIALING";
  return (
    <div role="status" className={clsx("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm lg:px-6", severe ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning")}>
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">{text}</span>
      {session.permissions.includes("billing.manage") && (
        <Link href="/settings/billing" className="font-medium underline-offset-2 hover:underline">
          {b.action}
        </Link>
      )}
    </div>
  );
}

const items = NAV_GROUPS.flatMap((g) => g.items);
const current = (pathname: string) => items.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));

/** Where the member is: the module's icon and name, so a glance at the header answers it. */
function Section() {
  const { t } = useI18n();
  const item = current(usePathname());
  if (!item) return null;
  return (
    <p className="hidden min-w-0 items-center gap-2 text-sm font-medium text-fg-muted md:flex" aria-hidden>
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-accent/15 to-brand-violet/15 text-accent">
        <item.icon className="h-4 w-4" />
      </span>
      <span className="truncate">{t.nav[item.key]}</span>
    </p>
  );
}

const BOTTOM: NavItem["key"][] = ["dashboard", "inbox", "crm", "tasks"];

/** Phones: the four everyday modules a thumb away; everything else under "More". */
function BottomNav({ session, summary, onMore }: { session: MeResponse; summary: ShellSummary; onMore: () => void }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const active = current(pathname);
  const links = BOTTOM.map((key) => items.find((i) => i.key === key)!).filter((i) => !i.permission || session.permissions.includes(i.permission));
  return (
    <nav aria-label={t.shell.bottomNav} className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden print:hidden">
      <ul className="mx-auto flex max-w-md">
        {links.map((item) => {
          const on = active?.key === item.key;
          const count = item.badge ? summary[item.badge] : 0;
          return (
            <li key={item.key} className="flex-1">
              <Link
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={clsx("relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", on ? "text-accent" : "text-fg-muted")}
              >
                {on && <span className="absolute inset-x-6 top-0 h-0.5 rounded-b bg-gradient-to-r from-accent to-brand-violet" aria-hidden />}
                <span className="relative">
                  <item.icon className="h-5 w-5" aria-hidden />
                  {count > 0 && (
                    <span className="tabular absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-[#dc2626] px-1 text-center text-[10px] font-semibold leading-4 text-white">{count > 99 ? "99+" : count}</span>
                  )}
                </span>
                {t.nav[item.key]}
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <button type="button" onClick={onMore} className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-fg-muted">
            <MoreHorizontal className="h-5 w-5" aria-hidden />
            {t.shell.more}
          </button>
        </li>
      </ul>
    </nav>
  );
}
