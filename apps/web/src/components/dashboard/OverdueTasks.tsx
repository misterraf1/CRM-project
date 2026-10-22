import clsx from "clsx";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Card, CardHeader } from "@/components/ui/Card";
import type { Priority, TaskPreview } from "@/lib/api/types";
import { formatDuration } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { interpolate, type Locale } from "@/lib/i18n/locales";

const PRIORITY_DOT: Record<Priority, string> = {
  LOW: "bg-fg-subtle",
  MEDIUM: "bg-accent",
  HIGH: "bg-warning",
  URGENT: "bg-danger",
};

export function OverdueTasks({ tasks, now, t, locale }: { tasks: TaskPreview[]; now: Date; t: Dictionary; locale: Locale }) {
  const d = t.dashboard.tasks;
  return (
    <Card>
      <CardHeader title={d.title} action={{ href: "/tasks", label: t.common.viewAll }} />
      {tasks.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-6 text-sm text-fg-muted">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          {d.empty}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border pb-1">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link href={`/tasks?t=${task.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/60">
                <span
                  title={d.priority[task.priority]}
                  className={clsx("h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[task.priority])}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{task.title}</p>
                  <p className="text-xs text-danger">
                    {interpolate(d.overdueBy, {
                      time: formatDuration((now.getTime() - new Date(task.dueAt).getTime()) / 60000, locale),
                    })}
                    <span className="text-fg-subtle"> · {d.priority[task.priority]}</span>
                  </p>
                </div>
                <span title={task.assignee.name}>
                  <Avatar name={task.assignee.name} size="sm" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
