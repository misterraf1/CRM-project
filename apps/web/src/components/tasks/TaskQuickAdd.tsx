"use client";

import { PRIORITIES, type MemberDto, type TaskDto } from "@axis/shared";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { fromDateTimeInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

interface Props {
  members: MemberDto[];
  selfMemberId: string;
  /** Extra fields for the created task, e.g. { contactId } on a contact card */
  defaults?: Record<string, string>;
  compact?: boolean;
}

export function TaskQuickAdd({ members, selfMemberId, defaults, compact }: Props) {
  const { t } = useI18n();
  const k = t.tasks;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const due = String(f.get("dueAt") || "");
    const body = {
      ...defaults,
      title: String(f.get("title")),
      assigneeId: String(f.get("assigneeId")) || null,
      priority: String(f.get("priority") || "MEDIUM"),
      dueAt: due ? fromDateTimeInput(due) : null,
    };
    setError(undefined);
    startTransition(async () => {
      const res = await api<TaskDto>("/tasks", "POST", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      form.reset();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} aria-busy={pending} className={compact ? "space-y-2" : "card space-y-2 p-3"}>
      <div className={compact ? "grid gap-2" : "grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_200px_130px_auto]"}>
        <input name="title" required maxLength={200} placeholder={k.titlePlaceholder} aria-label={k.quickAdd} className="input mt-0" />
        <select name="assigneeId" defaultValue={selfMemberId} aria-label={k.assignee} className="input mt-0">
          {members
            .filter((m) => m.status === "ACTIVE")
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
        </select>
        <input name="dueAt" type="datetime-local" aria-label={k.due} className="input mt-0" />
        {!compact && (
          <select name="priority" defaultValue="MEDIUM" aria-label={k.priority} className="input mt-0">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t.dashboard.tasks.priority[p]}
              </option>
            ))}
          </select>
        )}
        <button type="submit" disabled={pending} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden />
          {k.add}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  );
}
