import type { ScoreLevel } from "@/shared";
import clsx from "clsx";
import { Flame } from "lucide-react";

const STYLE: Record<ScoreLevel, string> = {
  hot: "bg-danger/10 text-danger",
  warm: "bg-warning/10 text-warning",
  cold: "bg-muted text-fg-muted",
};

/** Lead score chip; the reasons are in the title (and listed on the contact card). */
export function ScoreBadge({ level, score, label, title }: { level: ScoreLevel; score: number; label: string; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", STYLE[level])}>
      <Flame className="h-3 w-3" aria-hidden />
      {label} · {score}
    </span>
  );
}
