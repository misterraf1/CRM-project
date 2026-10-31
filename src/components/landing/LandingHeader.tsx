"use client";

import clsx from "clsx";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { APP_NAME } from "@/lib/config";
import { useI18n } from "@/lib/i18n/client";

/** Sticky header: glass once the page scrolls; a drawer on phones. */
export function LandingHeader({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const k = t.landing;
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const links = [
    ["#features", k.nav.features],
    ["#how", k.nav.how],
    ["#pricing", k.nav.pricing],
    ["#faq", k.nav.faq],
  ] as const;

  const actions = signedIn ? (
    <Link href="/dashboard" className="btn-primary">
      {k.toApp}
    </Link>
  ) : (
    <>
      <Link href="/login" className="btn-ghost">
        {k.login}
      </Link>
      <Link href="/signup" className="btn-primary">
        {k.start}
      </Link>
    </>
  );

  return (
    <header className={clsx("sticky top-0 z-40 transition-colors duration-200", scrolled || open ? "border-b border-border bg-bg/80 backdrop-blur-md" : "border-b border-transparent")}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-brand-violet text-sm font-bold text-white dark:text-bg">{APP_NAME[0]}</span>
          {APP_NAME}
        </Link>
        <nav aria-label={APP_NAME} className="ml-6 hidden items-center gap-1 md:flex">
          {links.map(([href, label]) => (
            <a key={href} href={href} className="rounded-md px-3 py-2 text-sm text-fg-muted hover:text-fg">
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <LocaleSwitcher />
          <ThemeToggle />
          {actions}
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? t.shell.closeMenu : t.shell.openMenu} className="ml-auto grid h-10 w-10 place-items-center rounded-lg text-fg-muted hover:bg-muted md:hidden">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-border px-4 pb-4 md:hidden">
          <nav aria-label={APP_NAME} className="flex flex-col py-2">
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setOpen(false)} className="rounded-md px-2 py-3 text-sm">
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
          <div className="mt-3 grid gap-2">{actions}</div>
        </div>
      )}
    </header>
  );
}
