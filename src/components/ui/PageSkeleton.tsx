"use client";

import clsx from "clsx";
import { useI18n } from "@/lib/i18n/client";

const Bar = ({ className }: { className?: string }) => <div className={clsx("rounded-md bg-muted motion-safe:animate-pulse", className)} />;

/**
 * Shown the instant a page is opened, while its server data loads (route loading
 * boundaries). Shapes follow the common page layout: heading, tiles, a list card.
 */
export function PageSkeleton({ tiles = true }: { tiles?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t.shell.loading}</span>
      <div className="space-y-2">
        <Bar className="h-6 w-48" />
        <Bar className="h-4 w-72 max-w-full" />
      </div>
      {tiles && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card space-y-3 p-4">
              <Bar className="h-3 w-24" />
              <Bar className="h-6 w-20" />
            </div>
          ))}
        </div>
      )}
      <div className="card divide-y divide-border">
        <div className="p-3">
          <Bar className="h-8 w-full max-w-md" />
        </div>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Bar className="h-8 w-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Bar className="h-3.5 w-1/3" />
              <Bar className="h-3 w-1/4" />
            </div>
            <Bar className="hidden h-3 w-16 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
