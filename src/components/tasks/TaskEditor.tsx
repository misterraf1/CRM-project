"use client";

import { PRIORITIES, TASK_STATUSES, type MemberDto, type ProjectDto, type TaskDetailDto, type TaskDto } from "@/shared";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { fromDateTimeInput, toDateTimeInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { RECURRENCE_OPTIONS } from "./meta";

export function TaskEditor({ task, members, projects }: { task: TaskDetailDto; members: MemberDto[]; projects: ProjectDto[] }) {
  const { t } = useI18n();
  const k = t.tasks;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const canEdit = task.can.edit;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { status: String(f.get("status")) };
    if (canEdit) {
      const due = String(f.get("dueAt") || "");
      Object.assign(body, {
        title: String(f.get("title")),
        description: String(f.get("description") || "") || null,
        priority: String(f.get("priority")),
        assigneeId: String(f.get("assigneeId")) || null,
        dueAt: due ? fromDateTimeInput(due) : null,
        projectId: String(f.get("projectId")) || null,
        recurrence: String(f.get("recurrence")) || null,
      });
    }
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const res = await api<TaskDto>(`/tasks/${task.id}`, "PATCH", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setSaved(true);
      router.refresh();
    });
  }

  function createProject(name: string) {
    startTransition(async () => {
      const res = await api<ProjectDto>("/projects", "POST", { name });
      if (!res.ok) return setError(errorMessage(t, res.code));
      await api(`/tasks/${task.id}`, "PATCH", { projectId: res.data.id });
      setNewProject(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
        {!canEdit && <p className="rounded-lg bg-muted px-3 py-2 text-xs text-fg-muted">{k.readOnly}</p>}
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
          <label className="field-label sm:col-span-2">
            {k.titlePlaceholder}
            <input name="title" required maxLength={200} defaultValue={task.title} disabled={!canEdit} className="input" />
          </label>
          <label className="field-label sm:col-span-2">
            {k.description}
            <textarea
              name="description"
              rows={4}
              maxLength={10000}
              defaultValue={task.description ?? ""}
              disabled={!canEdit}
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
            />
          </label>
          <label className="field-label">
            {t.crm.colStage}
            <select name="status" defaultValue={task.status} className="input">
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {k.statuses[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            {k.priority}
            <select name="priority" defaultValue={task.priority} disabled={!canEdit} className="input">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t.dashboard.tasks.priority[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            {k.assignee}
            <select name="assigneeId" defaultValue={task.assignee?.id ?? ""} disabled={!canEdit} className="input">
              <option value="">{t.crm.unassigned}</option>
              {members
                .filter((m) => m.status === "ACTIVE" || m.id === task.assignee?.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
            </select>
          </label>
          <label className="field-label">
            {k.due}
            <input name="dueAt" type="datetime-local" defaultValue={toDateTimeInput(task.dueAt)} disabled={!canEdit} className="input" />
          </label>
          <label className="field-label">
            {k.project}
            <select name="projectId" defaultValue={task.project?.id ?? ""} disabled={!canEdit} className="input">
              <option value="">{k.noProject}</option>
              {projects
                .filter((p) => !p.archived || p.id === task.project?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field-label">
            {k.recurrence}
            <select name="recurrence" defaultValue={task.recurrence ?? ""} disabled={!canEdit} className="input">
              {RECURRENCE_OPTIONS.map((o) => (
                <option key={o.key} value={o.value}>
                  {k.recurrences[o.key]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] font-normal text-fg-subtle">{k.recurrenceHint}</span>
          </label>
        </fieldset>
        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending} className="btn-primary">
            {k.save}
          </button>
          {saved && (
            <span role="status" className="text-sm text-success">
              {k.saved}
            </span>
          )}
        </div>
      </form>
      {canEdit &&
        (newProject ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createProject(String(new FormData(e.currentTarget).get("name")));
            }}
            className="flex gap-2"
          >
            <input name="name" required maxLength={100} placeholder={k.projectName} aria-label={k.projectName} className="input mt-0" autoFocus />
            <button type="submit" disabled={pending} className="btn-primary">
              {k.add}
            </button>
            <button type="button" onClick={() => setNewProject(false)} className="btn-ghost">
              {t.crm.cancel}
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setNewProject(true)} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {k.newProject}
          </button>
        ))}
    </div>
  );
}
