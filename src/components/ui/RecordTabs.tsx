"use client";

import clsx from "clsx";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface RecordTab {
  key: string;
  label: string;
  /** Small count after the label (omitted when 0) */
  count?: number;
  node: ReactNode;
}

/**
 * Sections of a record page behind tabs instead of one long scroll. The last tab
 * opened is remembered per page type (`memory`); arrow keys move between tabs.
 */
export function RecordTabs({ tabs, memory, label }: { tabs: RecordTab[]; memory: string; label: string }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const storageKey = `axis.tab.${memory}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && tabs.some((t) => t.key === saved)) setActive(saved);
    } catch {
      // Private mode: start on the first tab
    }
    // Restored once per page
  }, []);
  const pick = (key: string) => {
    setActive(key);
    try {
      localStorage.setItem(storageKey, key);
    } catch {
      // Not remembered, still switched
    }
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + tabs.length) % tabs.length;
    pick(tabs[next]!.key);
    refs.current[next]?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${memory}-${tab.key}`}
            aria-selected={active === tab.key}
            aria-controls={`panel-${memory}-${tab.key}`}
            tabIndex={active === tab.key ? 0 : -1}
            onClick={() => pick(tab.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={clsx(
              "-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active === tab.key ? "border-accent text-accent" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {tab.label}
            {!!tab.count && <span className="tabular rounded-full bg-muted px-1.5 text-[11px] font-semibold text-fg-muted">{tab.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} role="tabpanel" id={`panel-${memory}-${tab.key}`} aria-labelledby={`tab-${memory}-${tab.key}`} hidden={active !== tab.key} className="pt-5">
          {tab.node}
        </div>
      ))}
    </div>
  );
}
