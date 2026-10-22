"use client";

import type { TaskDto, TaskStatus } from "@axis/shared";
import clsx from "clsx";
import Link from "next/link";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { PriorityDot } from "./meta";
import { useToggleDone } from "./TaskList";

const COLUMNS: TaskStatus[] = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"];
const STEP = 1024;

export function TaskBoard({ tasks: initial }: { tasks: TaskDto[] }) {
  const { t, locale } = useI18n();
  const k = t.tasks;
  const { tasks, setStatus, error } = useToggleDone(initial);
  const dragged = useRef<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  const columns = useMemo(
    () => COLUMNS.map((status) => ({ status, items: tasks.filter((x) => x.status === status).sort((a, b) => a.position - b.position) })),
    [tasks],
  );

  function drop(e: DragEvent, status: TaskStatus) {
    e.preventDefault();
    setOver(null);
    const task = tasks.find((x) => x.id === dragged.current);
    dragged.current = null;
    if (!task || task.status === status) return;
    const last = columns.find((c) => c.status === status)!.items.at(-1);
    setStatus(task, status, (last?.position ?? 0) + STEP);
  }

  return (
    <div className="space-y-2">
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
        <div className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3">
          {columns.map(({ status, items }) => (
            <section
              key={status}
              aria-label={k.statuses[status]}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
              onDrop={(e) => drop(e, status)}
              className={clsx("flex min-w-0 flex-col rounded-xl border bg-muted/40", over === status ? "border-accent bg-accent-soft/40" : "border-border")}
            >
              <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <h2 className={clsx("text-sm font-semibold", status === "DONE" && "text-success")}>{k.statuses[status]}</h2>
                <span className="tabular text-xs text-fg-subtle">{items.length}</span>
              </header>
              <ol className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                {items.map((task) => (
                  <li
                    key={task.id}
                    draggable
                    onDragStart={(e) => {
                      dragged.current = task.id;
                      e.dataTransfer.setData("text/plain", task.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className="cursor-grab rounded-lg border border-border bg-surface p-2.5 shadow-sm active:cursor-grabbing"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5">
                        <PriorityDot priority={task.priority} label={t.dashboard.tasks.priority[task.priority]} />
                      </span>
                      <Link href={`/tasks/${task.id}`} draggable={false} className="min-w-0 flex-1 text-sm font-medium leading-snug hover:text-accent">
                        {task.title}
                      </Link>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-subtle">
                      <span className={clsx(task.overdue && "font-medium text-danger")}>{task.dueAt ? formatDateTime(task.dueAt, locale) : ""}</span>
                      {task.assignee && (
                        <span title={task.assignee.name}>
                          <Avatar name={task.assignee.name} size="sm" />
                        </span>
                      )}
                    </div>
                    {/* Keyboard and touch alternative to drag & drop */}
                    <select
                      aria-label={`${t.crm.colStage}: ${task.title}`}
                      value={task.status}
                      onChange={(e) => setStatus(task, e.target.value as TaskStatus)}
                      className="mt-2 h-7 w-full rounded-md border border-border bg-surface px-1.5 text-xs text-fg-muted"
                    >
                      {COLUMNS.map((s) => (
                        <option key={s} value={s}>
                          {k.statuses[s]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
