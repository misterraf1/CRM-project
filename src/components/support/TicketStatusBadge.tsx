import type { TicketStatus } from "@axis/shared";
import clsx from "clsx";

const STYLE: Record<TicketStatus, string> = {
  open: "bg-warning/10 text-warning",
  in_progress: "bg-accent-soft text-accent",
  closed: "bg-muted text-fg-subtle",
};

export function TicketStatusBadge({ status, label }: { status: TicketStatus; label: string }) {
  return <span className={clsx("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", STYLE[status])}>{label}</span>;
}
