"use client";

import type { CommentDto } from "@axis/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api/client";
import { formatRelative } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

export function Comments({ taskId, items }: { taskId: string; items: CommentDto[] }) {
  const { t, locale } = useI18n();
  const k = t.tasks;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    startTransition(async () => {
      const res = await api(`/tasks/${taskId}/comments`, "POST", { body });
      if (!res.ok) return setError(errorMessage(t, res.code));
      setBody("");
      setError(undefined);
      router.refresh();
    });
  }

  return (
    <section className="card">
      <h2 className="px-5 pt-4 text-sm font-semibold">{k.comments}</h2>
      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-fg-muted">{k.noComments}</p>
      ) : (
        <ol className="space-y-4 px-5 py-4">
          {items.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.author?.name ?? "?"} size="sm" />
              <div className="min-w-0">
                <p className="text-xs">
                  <span className="font-medium">{c.author?.name}</span>{" "}
                  <time dateTime={c.createdAt} className="text-fg-subtle">
                    {formatRelative(c.createdAt, new Date(), locale)}
                  </time>
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={submit} className="border-t border-border p-3">
        <label className="sr-only" htmlFor="comment">
          {k.comments}
        </label>
        <textarea
          id="comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
          rows={2}
          maxLength={5000}
          placeholder={k.commentPlaceholder}
          className="block w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        <div className="mt-2 flex justify-end">
          <button type="submit" disabled={pending || !body.trim()} className="btn-primary h-8 text-xs">
            {k.send}
          </button>
        </div>
      </form>
    </section>
  );
}
