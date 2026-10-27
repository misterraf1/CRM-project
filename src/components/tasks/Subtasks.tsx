"use client";

import type { TaskDto } from "@/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { TaskList } from "./TaskList";

export function Subtasks({ parentId, items }: { parentId: string; items: TaskDto[] }) {
  const { t } = useI18n();
  const k = t.tasks;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const done = items.filter((s) => s.status === "DONE").length;

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = String(new FormData(form).get("title"));
    startTransition(async () => {
      const res = await api("/tasks", "POST", { title, parentId });
      if (!res.ok) return setError(errorMessage(t, res.code));
      form.reset();
      setError(undefined);
      router.refresh();
    });
  }

  return (
    <section className="card">
      <header className="flex items-center justify-between px-5 pt-4">
        <h2 className="text-sm font-semibold">{k.subtasks}</h2>
        {items.length > 0 && <span className="tabular text-xs text-fg-subtle">{done}/{items.length}</span>}
      </header>
      {items.length > 0 && (
        <div className="mt-2 border-t border-border">
          <TaskList tasks={items} compact />
        </div>
      )}
      <form onSubmit={add} className="flex gap-2 border-t border-border p-3">
        <input name="title" required maxLength={200} placeholder={k.addSubtask} aria-label={k.addSubtask} className="input mt-0" />
        <button type="submit" disabled={pending} className="btn-primary">
          {k.add}
        </button>
      </form>
      {error && <p className="px-4 pb-3 text-xs text-danger">{error}</p>}
    </section>
  );
}
