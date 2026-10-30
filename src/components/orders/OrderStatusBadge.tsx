import type { OrderSummaryDto } from "@/shared";
import clsx from "clsx";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";

const STYLE: Record<string, string> = {
  new: "bg-muted text-fg-muted",
  in_progress: "bg-accent-soft text-accent",
  done: "bg-success/10 text-success",
  canceled: "bg-muted text-fg-subtle line-through",
  overdue: "bg-danger/10 text-danger",
};

export function OrderStatusBadge({ order, t }: { order: Pick<OrderSummaryDto, "status" | "overdue">; t: Dictionary }) {
  const state = order.overdue ? "overdue" : order.status;
  return <span className={clsx("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", STYLE[state])}>{t.orders.statuses[state]}</span>;
}

/** Done steps out of all, as a thin bar with the count. */
export function OrderProgress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular text-xs text-fg-muted">
        {done}/{total}
      </span>
    </span>
  );
}
