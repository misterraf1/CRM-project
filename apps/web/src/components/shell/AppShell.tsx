"use client";

import clsx from "clsx";
import { Menu } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { MeResponse } from "@axis/shared";
import type { ShellSummary } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n/client";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { NotificationBell } from "./NotificationBell";
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
      <Sidebar
        session={session}
        summary={summary}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className={clsx("transition-[padding] duration-200", collapsed ? "lg:pl-[68px]" : "lg:pl-60")}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur lg:px-6">
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
        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
