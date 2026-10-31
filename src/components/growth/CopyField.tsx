"use client";

import { useState } from "react";

/** Read-only value with a copy button (links, embed codes). */
export function CopyField({ label, value, copy, copied, multiline }: { label: string; value: string; copy: string; copied: string; multiline?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="field-label">
      {label}
      <div className="mt-1 flex items-start gap-2">
        {multiline ? (
          <textarea readOnly value={value} rows={3} aria-label={label} className="input min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <input readOnly value={value} aria-label={label} className="input min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        )}
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(value).then(() => setDone(true))}
          className="btn-ghost shrink-0 border border-border"
        >
          {done ? copied : copy}
        </button>
      </div>
    </div>
  );
}
