"use client";

import clsx from "clsx";
import { CircleHelp, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { NAV_ITEMS } from "@/lib/navigation";

const SEEN_KEY = "axis.help.seen";

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * "?" in the header: what the current page is for, in two or three sentences. A dot
 * marks pages whose help hasn't been opened yet; nothing ever opens on its own.
 */
export function HelpPanel() {
  const { t } = useI18n();
  const k = t.help;
  const pathname = usePathname();
  const item = NAV_ITEMS.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  const key = item?.key;
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    setOpen(false);
    setUnseen(!!key && !readSeen().includes(key));
  }, [key]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (setOpen(false), root.current?.querySelector<HTMLButtonElement>("button")?.focus());
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!key) return null;
  const lines = k.modules[key as keyof typeof k.modules] ?? [];

  const toggle = () => {
    setOpen((v) => !v);
    if (unseen) {
      setUnseen(false);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...readSeen(), key]));
      } catch {
        // Private mode: the dot simply comes back next time
      }
    }
  };

  return (
    <div ref={root} className="relative">
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} aria-label={k.button} title={k.button} className="relative grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:bg-muted hover:text-fg">
        <CircleHelp className="h-[18px] w-[18px]" aria-hidden />
        {unseen && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" aria-label={k.newBadge} />}
      </button>
      <div id={id} role="dialog" aria-label={k.title} hidden={!open} className={clsx("absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-4 shadow-xl")}>
        {open && (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{k.title}</p>
                <p className="text-sm font-semibold">{t.nav[key]}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={k.close} className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-muted">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {lines.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-3 flex gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-fg-muted">
              <Search className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {k.search}
            </p>
            <Link href="/support" onClick={() => setOpen(false)} className="mt-3 inline-block text-sm font-medium text-accent hover:underline">
              {k.more}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
