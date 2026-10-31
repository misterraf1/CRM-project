import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";
import Link from "next/link";

/** An empty list that says why it is empty and what to do next. */
export function EmptyState({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: string; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-4 font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-fg-muted">{hint}</p>}
      {action && (
        <Link href={action.href} className="btn-primary mt-5">
          <Plus className="h-4 w-4" aria-hidden />
          {action.label}
        </Link>
      )}
    </div>
  );
}
