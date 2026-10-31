import type { CaseStatus } from "@/shared";
import clsx from "clsx";

const STATUS_STYLE: Record<CaseStatus, string> = {
  open: "bg-accent-soft text-accent",
  in_progress: "bg-warning/10 text-warning",
  waiting: "bg-muted text-fg-muted",
  resolved: "bg-success/10 text-success",
  closed: "bg-muted text-fg-subtle",
};

export function CaseStatusBadge({ status, label }: { status: CaseStatus; label: string }) {
  return <span className={clsx("inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>{label}</span>;
}
