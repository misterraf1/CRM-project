"use client";

import type { TaskDto } from "@axis/shared";
import clsx from "clsx";
import { Check, MessageSquare, Paperclip, Repeat } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { PriorityDot } from "./meta";

/** One-click completion with optimistic update; reverts if the API refuses. */
export function useToggleDone(initial: TaskDto[]) {
  const { t } = useI18n();
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();
  useEffect(() => {
    setTasks(initial);
  }, [initial]);

  function setStatus(task: TaskDto, status: TaskDto["status"], position?: number) {
    const before = tasks;
    setTasks((all) => all.map((x) => (x.id === task.id ? { ...x, status, position: position ?? x.position } : x)));
    setError(undefined);
    startTransition(async () => {
      const res = await api(`/tasks/${task.id}`, "PATCH", position === undefined ? { status } : { status, position });
      if (!res.ok) {
        setTasks(before);
        setError(errorMessage(t, res.code));
      }
      router.refresh();
    });
  }
  return { tasks, setStatus, error };
}

export function TaskList({ tasks: initial, compact }: { tasks: TaskDto[]; compact?: boolean }) {
  const { t, locale } = useI18n();
  const k = t.tasks;
  const { tasks, setStatus, error } = useToggleDone(initial);

  if (tasks.length === 0) {
    return compact ? (
      <p className="px-5 py-4 text-sm text-fg-muted">{k.noReminders}</p>
    ) : (
      <div className="card px-4 py-12 text-center">
        <p className="text-sm font-medium">{k.empty}</p>
        <p className="mt-1 text-sm text-fg-muted">{k.emptyHint}</p>
      </div>
    );
  }

  return (
    <div className={compact ? "" : "card"}>
      {error && <p role="alert" className="border-b border-border bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-border">
        {tasks.map((task) => {
          const done = task.status === "DONE";
          return (
            <li key={task.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                aria-label={`${done ? k.markOpen : k.markDone}: ${task.title}`}
                onClick={() => setStatus(task, done ? "TODO" : "DONE")}
                className={clsx(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                  done ? "border-success bg-success text-white" : "border-border hover:border-accent",
                )}
              >
                {done && <Check className="h-3.5 w-3.5" aria-hidden />}
              </button>
              <PriorityDot priority={task.priority} label={t.dashboard.tasks.priority[task.priority]} />
              <div className="min-w-0 flex-1">
                <Link href={`/tasks/${task.id}`} className={clsx("block truncate text-sm hover:text-accent", done && "text-fg-subtle line-through")}>
                  {task.title}
                </Link>
                <div className="flex flex-wrap items-center gap-x-3 text-xs text-fg-subtle">
                  {task.dueAt && <span className={clsx(task.overdue && "font-medium text-danger")}>{formatDateTime(task.dueAt, locale)}</span>}
                  {task.status !== "TODO" && !done && <span>{k.statuses[task.status]}</span>}
                  {task.project && <span>{task.project.name}</span>}
                  {!compact && task.contact && <span>{task.contact.name}</span>}
                  {task.subtasks.total > 0 && <span>{task.subtasks.done}/{task.subtasks.total}</span>}
                  {task.comments > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <MessageSquare className="h-3 w-3" aria-hidden />
                      {task.comments}
                    </span>
                  )}
                  {task.files > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <Paperclip className="h-3 w-3" aria-hidden />
                      {task.files}
                    </span>
                  )}
                  {task.recurrence && <Repeat className="h-3 w-3" aria-label={k.recurrence} />}
                </div>
              </div>
              {task.assignee && (
                <span title={task.assignee.name}>
                  <Avatar name={task.assignee.name} size="sm" />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
