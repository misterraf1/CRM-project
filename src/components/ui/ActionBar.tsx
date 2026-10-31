import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

export interface Action {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Links leaving the app (tel:, mailto:) */
  external?: boolean;
  primary?: boolean;
}

/** The record's next steps as one row of buttons (scrolls sideways on phones). */
export function ActionBar({ actions, label }: { actions: Action[]; label: string }) {
  if (!actions.length) return null;
  return (
    <nav aria-label={label} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {actions.map(({ label: text, href, icon: Icon, external, primary }) => {
        const cls = clsx(
          "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors",
          primary ? "border-accent bg-accent text-accent-fg hover:bg-accent/90" : "border-border bg-surface text-fg hover:border-accent/40 hover:bg-accent-soft hover:text-accent",
        );
        return external ? (
          <a key={text} href={href} className={cls}>
            <Icon className="h-4 w-4" aria-hidden />
            {text}
          </a>
        ) : (
          <Link key={text} href={href} className={cls}>
            <Icon className="h-4 w-4" aria-hidden />
            {text}
          </Link>
        );
      })}
    </nav>
  );
}
