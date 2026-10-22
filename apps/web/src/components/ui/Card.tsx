import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx("card", className)}>{children}</section>;
}

export function DemoBadge({ label, hint }: { label: string; hint?: string }) {
  return (
    <span title={hint} className="rounded-full border border-warning/30 bg-warning/10 px-1.5 text-[10px] font-semibold leading-4 text-warning">
      {label}
    </span>
  );
}

export function CardHeader({
  title,
  meta,
  action,
  badge,
}: {
  title: string;
  meta?: ReactNode;
  action?: { href: string; label: string };
  badge?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 px-5 pt-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {badge}
        </h2>
        {meta && <p className="mt-0.5 text-xs text-fg-subtle">{meta}</p>}
      </div>
      {action && (
        <Link href={action.href} className="shrink-0 text-xs font-medium text-accent hover:underline">
          {action.label}
        </Link>
      )}
    </header>
  );
}
