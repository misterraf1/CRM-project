"use client";

import type { Permission } from "@/shared";
import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { allowedQuickCreate } from "@/lib/quick-create";

/** "+ New" in the header: a customer, deal, task, meeting, quote or case from any page. */
export function QuickCreate({ permissions }: { permissions: Permission[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const pathname = usePathname();
  const items = allowedQuickCreate(permissions);

  // A followed link closes the menu
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!items.length) return null;
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t.shell.create}
        className="btn-primary h-8 gap-1 px-2.5 text-xs sm:px-3"
      >
        <Plus className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">{t.shell.createShort}</span>
      </button>
      <div id={menuId} hidden={!open} className="absolute right-0 top-10 z-40 w-60 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-xl">
        <ul aria-label={t.shell.create}>
          {items.map(({ key, href, icon: Icon, tone }) => (
            <li key={key}>
              <Link href={href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted">
                <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-lg", tone)}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                {t.dashboard.quick[key]}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
