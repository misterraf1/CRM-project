import clsx from "clsx";

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Text shown at the end of the row (formatted value) */
  display: string;
  hint?: string;
  tone?: "series" | "success" | "danger";
}

/**
 * Horizontal bars for ranked or ordered categories (funnel stages, reasons, sources).
 * One series, one axis; every row carries its own label, so it reads without a legend.
 */
export function BarList({ rows, empty }: { rows: BarRow[]; empty: string }) {
  if (!rows.length) return <p className="py-4 text-sm text-fg-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="tabular shrink-0 font-medium">
              {r.display}
              {r.hint && <span className="ml-1.5 text-xs font-normal text-fg-subtle">{r.hint}</span>}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={clsx("h-full rounded-full", r.tone === "success" ? "bg-success" : r.tone === "danger" ? "bg-danger" : "bg-series-1")}
              style={{ width: `${r.value ? Math.max(2, (r.value / max) * 100) : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
