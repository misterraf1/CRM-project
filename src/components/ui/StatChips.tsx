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

const TONE = {
  default: { text: "text-accent", icon: "bg-accent/10 text-accent", card: "bg-accent-soft/50 border-accent/15" },
  accent: { text: "text-accent", icon: "bg-accent/10 text-accent", card: "bg-accent-soft/50 border-accent/15" },
  success: { text: "text-success", icon: "bg-success/10 text-success", card: "bg-success/5 border-success/15" },
  warning: { text: "text-warning", icon: "bg-warning/10 text-warning", card: "bg-warning/5 border-warning/15" },
  danger: { text: "text-danger", icon: "bg-danger/10 text-danger", card: "bg-danger/5 border-danger/15" },
};

/** Counts at the top of a list; each one is also the filter that shows those rows. */
export function StatChips({ chips, label }: { chips: StatChip[]; label: string }) {
  return (
    <nav aria-label={label} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {chips.map(({ label: text, value, href, icon: Icon, tone = "default", active }) => (
        <Link
          key={text}
          href={href}
          aria-current={active ? "true" : undefined}
          className={clsx(
            "flex items-center gap-3 rounded-2xl border px-4 py-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md sm:gap-4 sm:px-5",
            TONE[tone].card,
            active && "ring-2 ring-accent/40",
          )}
        >
          {Icon && (
            <span className={clsx("grid h-11 w-11 shrink-0 place-items-center rounded-full", TONE[tone].icon)}>
              <Icon className="h-5 w-5" aria-hidden />
            </span>
          )}
          <span className="min-w-0">
            <span className="tabular block text-2xl font-bold leading-tight text-fg">{value}</span>
            <span className="block truncate text-sm text-fg-muted">{text}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
