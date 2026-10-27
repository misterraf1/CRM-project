import clsx from "clsx";

/** Headline number with a label (and an optional one-line hint). */
export function StatTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "success" }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={clsx("tabular mt-1 text-2xl font-semibold tracking-tight", tone === "danger" && "text-danger", tone === "success" && "text-success")}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}
