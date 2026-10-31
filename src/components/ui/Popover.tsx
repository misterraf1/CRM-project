"use client";

import clsx from "clsx";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A button that opens a small panel (menus, pickers). Closes on outside click and
 * Escape (focus returns to the button); the panel stays out of the page while closed.
 */
export function Popover({
  label,
  trigger,
  children,
  className,
  panelClassName,
  side = "bottom",
  align = "right",
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  panelClassName?: string;
  side?: "top" | "bottom";
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

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

  return (
    <div ref={root} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={id} aria-label={label} title={label} className={className}>
        {trigger}
      </button>
      <div
        id={id}
        hidden={!open}
        className={clsx(
          "absolute z-30 min-w-48 rounded-xl border border-border bg-surface p-1.5 shadow-xl",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          align === "right" ? "right-0" : "left-0",
          panelClassName,
        )}
      >
        {open && children(() => setOpen(false))}
      </div>
    </div>
  );
}

/** A row inside a Popover menu. */
export function MenuItem({ icon, children, onClick, disabled, title, pressed }: { icon?: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean; title?: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={pressed}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon && <span className="grid h-5 w-5 shrink-0 place-items-center text-fg-muted">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
