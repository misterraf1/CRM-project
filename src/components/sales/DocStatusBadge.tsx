import type { DocSummaryDto } from "@/shared";
import clsx from "clsx";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";

const STYLE: Record<string, string> = {
  draft: "bg-muted text-fg-muted",
  sent: "bg-accent-soft text-accent",
  issued: "bg-accent-soft text-accent",
  accepted: "bg-success/10 text-success",
  paid: "bg-success/10 text-success",
  partly: "bg-warning/10 text-warning",
  rejected: "bg-danger/10 text-danger",
  expired: "bg-warning/10 text-warning",
  overdue: "bg-danger/10 text-danger",
  void: "bg-muted text-fg-subtle line-through",
};

/** Stored status, or the derived one that matters more (expired, overdue, partly paid). */
export function docState(d: Pick<DocSummaryDto, "status" | "expired" | "overdue" | "paidAmount" | "total">) {
  if (d.expired) return "expired";
  if (d.overdue) return "overdue";
  if (d.status === "issued" && d.paidAmount > 0) return "partly";
  return d.status;
}

export function DocStatusBadge({ doc, t }: { doc: Pick<DocSummaryDto, "status" | "expired" | "overdue" | "paidAmount" | "total">; t: Dictionary }) {
  const state = docState(doc);
  return <span className={clsx("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", STYLE[state])}>{t.sales.statuses[state as keyof Dictionary["sales"]["statuses"]]}</span>;
}
