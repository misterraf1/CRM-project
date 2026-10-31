import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

export interface StatChip {
  label: string;
  value: number | string;
  href: string;
  icon?: LucideIcon;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
  active?: boolean;
}

const TONE = { default: "text-fg-muted", accent: "text-accent", success: "text-success", warning: "text-warning", danger: "text-danger" };

/** Counts at the top of a list; each one is also the filter that shows those rows. */
export function StatChips({ chips, label }: { chips: StatChip[]; label: string }) {
  return (
    <nav aria-label={label} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {chips.map(({ label: text, value, href, icon: Icon, tone = "default", active }) => (
        <Link
          key={text}
          href={href}
          aria-current={active ? "true" : undefined}
          className={clsx(
            "card flex items-center gap-3 px-4 py-2.5 transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-sm sm:min-w-40",
            active && "border-accent ring-1 ring-accent/30",
          )}
        >
          {Icon && <Icon className={clsx("h-4 w-4 shrink-0", TONE[tone])} aria-hidden />}
          <span className="min-w-0">
            <span className={clsx("tabular block text-lg font-semibold leading-tight", tone !== "default" && TONE[tone])}>{value}</span>
            <span className="block truncate text-xs text-fg-muted">{text}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
