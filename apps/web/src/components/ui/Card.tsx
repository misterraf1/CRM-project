import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx("card", className)}>{children}</section>;
}

export function CardHeader({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <header className="flex items-start justify-between gap-3 px-5 pt-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
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
