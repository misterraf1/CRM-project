import type { Permission } from "@/shared";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { allowedQuickCreate } from "@/lib/quick-create";

/** The everyday "new …" buttons, one tap from the dashboard. */
export function QuickActions({ permissions, t }: { permissions: Permission[]; t: Dictionary }) {
  const k = t.dashboard.quick;
  const items = allowedQuickCreate(permissions);
  if (!items.length) return null;
  return (
    <nav aria-label={k.title} className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {items.map(({ key, href, icon: Icon, tone }) => (
        <Link
          key={key}
          href={href}
          className="card group flex flex-col items-center gap-2 px-2 py-3 text-center transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md sm:flex-row sm:px-3 sm:text-left"
        >
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone}`}>
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 text-xs font-medium sm:text-sm">
            <span aria-hidden className="text-fg-subtle">+ </span>
            {k[key]}
          </span>
        </Link>
      ))}
    </nav>
  );
}
