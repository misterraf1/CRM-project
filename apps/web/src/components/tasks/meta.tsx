import type { TaskPriority } from "@axis/shared";
import clsx from "clsx";

export const PRIORITY_DOT: Record<TaskPriority, string> = {
  LOW: "bg-fg-subtle",
  MEDIUM: "bg-accent",
  HIGH: "bg-warning",
  URGENT: "bg-danger",
};

export function PriorityDot({ priority, label }: { priority: TaskPriority; label: string }) {
  return <span title={label} aria-label={label} className={clsx("inline-block h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[priority])} />;
}

/** RRULE values offered in the UI (the API accepts this subset). */
export const RECURRENCE_OPTIONS = [
  { value: "", key: "none" },
  { value: "FREQ=DAILY", key: "daily" },
  { value: "FREQ=WEEKLY", key: "weekly" },
  { value: "FREQ=WEEKLY;INTERVAL=2", key: "biweekly" },
  { value: "FREQ=MONTHLY", key: "monthly" },
] as const;
