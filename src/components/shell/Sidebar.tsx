"use client";

import { PresenceToggle } from "./PresenceToggle";
import clsx from "clsx";
import type { MeResponse } from "@/shared";
import { ChevronsLeft, ChevronsRight, Lock, LogOut, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import type { ShellSummary } from "@/lib/api/types";
import { hasFeature } from "@/lib/billing";
import { APP_NAME } from "@/lib/config";
import { useI18n } from "@/lib/i18n/client";
import { interpolate } from "@/lib/i18n/locales";
import { SIMPLE_HIDDEN, visibleGroups } from "@/lib/navigation";
import { objectIcon } from "@/lib/object-icons";

interface Props {
  session: MeResponse;
  summary: ShellSummary;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  simple: boolean;
  onToggleSimple: () => void;
}

const DAY_MS = 86_400_000;

export function Sidebar({ session, summary, collapsed, onToggleCollapsed, mobileOpen, onCloseMobile, simple, onToggleSimple }: Props) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { subscription } = session;
  const trialDays =
    subscription.status === "TRIALING" && subscription.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / DAY_MS))
      : null;
  // On mobile the drawer is always full width
  const narrow = collapsed && !mobileOpen;

  return (
    <>
      <div
        className={clsx("fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] lg:hidden", mobileOpen ? "block" : "hidden")}
        onClick={onCloseMobile}
        aria-hidden
      />
      <aside
        aria-label={t.shell.mainNav}
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-nav-border bg-nav-bg text-nav-fg transition-[width,transform] duration-200 print:hidden",
          narrow ? "w-[68px]" : "w-60",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className={clsx("flex h-14 items-center gap-2.5 border-b border-nav-border", narrow ? "justify-center px-2" : "px-4")}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] text-sm font-bold text-white shadow-lg shadow-[#3b82f6]/30">
            {APP_NAME[0]}
          </span>
          {!narrow && (
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold text-white">{session.tenant.name}</p>
              <p className="truncate text-[11px] text-nav-muted">{APP_NAME} CRM</p>
            </div>
          )}
          <button
            type="button"
            onClick={onCloseMobile}
            className="grid h-8 w-8 place-items-center rounded-lg text-nav-muted hover:bg-nav-hover hover:text-white lg:hidden"
            aria-label={t.shell.closeMenu}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 [scrollbar-color:rgb(var(--nav-hover))_transparent]">
          {visibleGroups(session.permissions, simple ? [...session.tenant.workspace.hiddenModules, ...SIMPLE_HIDDEN] : session.tenant.workspace.hiddenModules).map((group) => (
            <div key={group.label} className="mb-4">
              {!narrow && (
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-nav-muted">
                  {t.nav[group.label]}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const count = item.badge ? summary[item.badge] : 0;
                  const label = t.nav[item.key];
                  const locked = !!item.feature && !hasFeature(session, item.feature);
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        onClick={onCloseMobile}
                        title={narrow ? label : locked ? t.billing.lockedHint : undefined}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "group relative flex h-9 items-center gap-3 rounded-lg text-sm transition-colors duration-150",
                          narrow ? "justify-center" : "px-3",
                          active
                            ? "bg-gradient-to-r from-[#3b82f6]/30 to-[#8b5cf6]/10 font-medium text-white"
                            : locked
                              ? "text-nav-muted hover:bg-nav-hover hover:text-white"
                              : "text-nav-fg hover:bg-nav-hover hover:text-white",
                        )}
                      >
                        {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-gradient-to-b from-[#60a5fa] to-[#a78bfa]" aria-hidden />}
                        <item.icon className={clsx("h-[18px] w-[18px] shrink-0", active ? "text-[#93c5fd]" : "text-nav-muted group-hover:text-white")} aria-hidden />
                        {!narrow && <span className="flex-1 truncate">{label}</span>}
                        {!narrow && locked && <Lock className="h-3.5 w-3.5 text-nav-muted" aria-label={t.billing.lockedHint} />}
                        {count > 0 &&
                          (narrow ? (
                            <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-danger" aria-label={String(count)} />
                          ) : (
                            <span
                              className={clsx(
                                "tabular rounded-full px-1.5 text-[11px] font-semibold leading-5",
                                item.badge === "overdue" ? "bg-[#dc2626] text-white" : item.badge === "unreadChat" ? "bg-[#15803d] text-white" : "bg-[#2563eb] text-white",
                              )}
                            >
                              {count}
                            </span>
                          ))}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {session.tenant.objects.length > 0 && (
            <div className="mb-4">
              {!narrow && <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-nav-muted">{t.objects.group}</p>}
              <ul className="space-y-0.5">
                {session.tenant.objects.map((o) => {
                  const href = `/records/${o.id}`;
                  const active = pathname === href || pathname.startsWith(`${href}/`);
                  const Icon = objectIcon(o.icon);
                  return (
                    <li key={o.id}>
                      <Link
                        href={href}
                        onClick={onCloseMobile}
                        title={narrow ? o.name : undefined}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "group relative flex h-9 items-center gap-3 rounded-lg text-sm transition-colors duration-150",
                          narrow ? "justify-center" : "px-3",
                          active ? "bg-gradient-to-r from-[#3b82f6]/30 to-[#8b5cf6]/10 font-medium text-white" : "text-nav-fg hover:bg-nav-hover hover:text-white",
                        )}
                      >
                        {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-gradient-to-b from-[#60a5fa] to-[#a78bfa]" aria-hidden />}
                        <Icon className={clsx("h-[18px] w-[18px] shrink-0", active ? "text-[#93c5fd]" : "text-nav-muted group-hover:text-white")} aria-hidden />
                        {!narrow && <span className="flex-1 truncate">{o.name}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </nav>

        <div className="border-t border-nav-border p-2">
          {trialDays !== null && !narrow && (
            <Link
              href="/settings"
              className="mb-2 block rounded-lg bg-gradient-to-r from-[#3b82f6]/25 to-[#8b5cf6]/25 px-3 py-2 text-xs font-medium text-white ring-1 ring-inset ring-white/10 hover:underline"
            >
              {interpolate(t.shell.trial, { plan: subscription.plan, days: trialDays })}
            </Link>
          )}
          <div className={clsx("flex items-center gap-2.5 rounded-lg p-1.5", narrow && "flex-col justify-center gap-1")}>
            <Avatar name={session.user.fullName} />
            {!narrow && (
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-medium text-white">{session.user.fullName}</p>
                <p className="truncate text-[11px] text-nav-muted">{session.membership.customRole?.name ?? t.shell.roles[session.membership.role]}</p>
                <PresenceToggle initial={session.membership.presence} />
              </div>
            )}
            <form action="/auth/logout" method="post">
              <button
                type="submit"
                className="grid h-8 w-8 place-items-center rounded-lg text-nav-muted hover:bg-nav-hover hover:text-[#f87171]"
                title={t.auth.logout}
                aria-label={t.auth.logout}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
          {session.memberships.length > 1 && !narrow && (
            <form action="/auth/switch" method="post" className="mt-1 px-1.5">
              <label className="sr-only" htmlFor="workspace">
                {t.auth.switchWorkspace}
              </label>
              <select
                id="workspace"
                name="tenantId"
                defaultValue={session.tenant.id}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="h-8 w-full rounded-lg border border-nav-border bg-nav-hover px-2 text-xs text-nav-fg"
              >
                {session.memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.tenantName}
                  </option>
                ))}
              </select>
            </form>
          )}
          <button
            type="button"
            onClick={onToggleSimple}
            aria-pressed={simple}
            title={t.help.simpleHint}
            className={clsx("mt-1 flex h-8 w-full items-center gap-2 rounded-lg text-xs hover:bg-nav-hover hover:text-white", narrow ? "justify-center" : "px-3", simple ? "text-white" : "text-nav-muted")}
          >
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            {narrow ? <span className="sr-only">{t.help.simple}</span> : <span className="flex-1 text-left">{t.help.simple}</span>}
            {!narrow && <span className={clsx("h-4 w-7 rounded-full p-0.5 transition-colors", simple ? "bg-[#3b82f6]" : "bg-nav-hover")} aria-hidden><span className={clsx("block h-3 w-3 rounded-full bg-white transition-transform", simple && "translate-x-3")} /></span>}
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="mt-1 hidden h-8 w-full items-center justify-center rounded-lg text-nav-muted hover:bg-nav-hover hover:text-white lg:flex"
            aria-label={collapsed ? t.shell.expand : t.shell.collapse}
            title={collapsed ? t.shell.expand : t.shell.collapse}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>
    </>
  );
}
