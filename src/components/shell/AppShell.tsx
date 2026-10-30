"use client";

import clsx from "clsx";
import { AlertTriangle, Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { MeResponse } from "@/shared";
import type { ShellSummary } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { interpolate } from "@/lib/i18n/locales";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { NotificationBell } from "./NotificationBell";
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
        <header className="sticky top-0 z-20 flex print:hidden h-14 items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:bg-muted lg:hidden"
            aria-label={t.shell.openMenu}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell unread={summary.unreadNotifications} />
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <SubscriptionBanner session={session} />
        <main id="main" tabIndex={-1} className="mx-auto max-w-[1400px] px-4 py-6 outline-none lg:px-6 print:p-0">{children}</main>
      </div>
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
