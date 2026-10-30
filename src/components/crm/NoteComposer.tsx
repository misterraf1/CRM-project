"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { MentionTextarea } from "@/components/ui/MentionTextarea";

export function NoteComposer({ contactId }: { contactId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    const sent = body;
    startTransition(async () => {
      const res = await api(`/contacts/${contactId}/notes`, "POST", { body: sent });
      if (!res.ok) return setError(errorMessage(t, res.code));
      setBody((current) => (current === sent ? "" : current));
      setError(undefined);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="border-b border-border p-4">
      <label className="sr-only" htmlFor="note">
        {t.crm.addNote}
      </label>
      <MentionTextarea
        id="note"
        value={body}
        onChange={setBody}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
        rows={2}
        maxLength={5000}
        placeholder={t.crm.notePlaceholder}
        className="block w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex justify-end">
        <button type="submit" disabled={pending || !body.trim()} className="btn-primary h-8 text-xs">
          {t.crm.addNote}
        </button>
      </div>
    </form>
  );
}
