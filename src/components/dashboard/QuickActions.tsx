import type { Permission } from "@/shared";
import { CalendarPlus, CheckSquare, FilePlus2, Handshake, Headset, UserPlus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";

const ACTIONS: { key: "contact" | "deal" | "task" | "meeting" | "quote" | "case"; href: string; icon: LucideIcon; tone: string; permission?: Permission }[] = [
  { key: "contact", href: "/crm/new", icon: UserPlus, tone: "text-accent bg-accent-soft", permission: "contacts.create" },
  { key: "deal", href: "/deals?new=1", icon: Handshake, tone: "text-brand-violet bg-brand-violet/10", permission: "deals.create" },
  { key: "task", href: "/tasks", icon: CheckSquare, tone: "text-success bg-success/10", permission: "tasks.create" },
  { key: "meeting", href: "/calendar?new=1", icon: CalendarPlus, tone: "text-brand-teal bg-brand-teal/10", permission: "tasks.create" },
  { key: "quote", href: "/sales/new", icon: FilePlus2, tone: "text-warning bg-warning/10", permission: "quotes.manage" },
  { key: "case", href: "/cases/new", icon: Headset, tone: "text-danger bg-danger/10", permission: "cases.manage" },
];

/** The everyday "new …" buttons, one tap from the dashboard. */
export function QuickActions({ permissions, t }: { permissions: Permission[]; t: Dictionary }) {
  const k = t.dashboard.quick;
  const items = ACTIONS.filter((a) => !a.permission || permissions.includes(a.permission));
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
