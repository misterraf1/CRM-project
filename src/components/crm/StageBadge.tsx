import type { LifecycleStage } from "@axis/shared";
import clsx from "clsx";

const STYLE: Record<LifecycleStage, string> = {
  LEAD: "bg-accent-soft text-accent",
  QUALIFIED: "bg-warning/10 text-warning",
  CUSTOMER: "bg-success/10 text-success",
  CHURNED: "bg-muted text-fg-subtle",
};

export function StageBadge({ stage, label }: { stage: LifecycleStage; label: string }) {
  return <span className={clsx("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", STYLE[stage])}>{label}</span>;
}
