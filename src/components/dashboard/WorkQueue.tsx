"use client";

import clsx from "clsx";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/client";

/**
 * Messages, overdue tasks and payments behind one set of tabs instead of three
 * stacked cards: the busiest tab opens first, counts show what waits elsewhere.
 */
export function WorkQueue({ panels }: { panels: { key: string; label: string; count: number; node: ReactNode }[] }) {
  const { t } = useI18n();
  const first = [...panels].sort((a, b) => b.count - a.count)[0]?.key ?? panels[0]?.key;
  const [tab, setTab] = useState(first);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + panels.length) % panels.length;
    setTab(panels[next]!.key);
    refs.current[next]?.focus();
  };
  return (
    <section aria-label={t.dashboard.queue.title} className="space-y-2">
      <div role="tablist" aria-label={t.dashboard.queue.title} className="flex gap-1 rounded-xl bg-muted p-1">
        {panels.map((p, i) => (
          <button
            key={p.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`queue-tab-${p.key}`}
            aria-selected={tab === p.key}
            aria-controls={`queue-panel-${p.key}`}
            tabIndex={tab === p.key ? 0 : -1}
            onClick={() => setTab(p.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={clsx("flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors", tab === p.key ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
          >
            {p.label}
            {p.count > 0 && <span className={clsx("tabular rounded-full px-1.5 text-[11px] font-semibold", tab === p.key ? "bg-accent text-accent-fg" : "bg-surface text-fg-muted")}>{p.count}</span>}
          </button>
        ))}
      </div>
      {panels.map((p) => (
        <div key={p.key} role="tabpanel" id={`queue-panel-${p.key}`} aria-labelledby={`queue-tab-${p.key}`} hidden={tab !== p.key}>
          {p.node}
        </div>
      ))}
    </section>
  );
}
