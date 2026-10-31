"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";

/** "Rows per page" — each choice is a URL, so the list reloads with it. */
export function PageSize({ value, label, hrefs }: { value: number; label: string; hrefs: Record<number, string> }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-fg-muted">
      {label}:
      <span className="relative">
        <select value={value} onChange={(e) => router.push(hrefs[Number(e.target.value)]!)} className="h-9 appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm font-medium text-fg outline-none focus:border-accent">
          {Object.keys(hrefs).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-fg-subtle" aria-hidden />
      </span>
    </label>
  );
}
