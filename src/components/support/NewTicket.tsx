"use client";

import { TICKET_PRIORITIES, type TicketDto } from "@axis/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

export function NewTicket() {
  const { t } = useI18n();
  const s = t.support;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    startTransition(async () => {
      setError(undefined);
      const res = await api<TicketDto>("/support/tickets", "POST", { subject: String(f.get("subject")), body: String(f.get("body")), priority: f.get("priority") });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      router.push(`/support/${res.data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-5">
      <h2 className="text-sm font-semibold">{s.new}</h2>
      <label className="field-label">
        {s.subject}
        <input name="subject" required minLength={3} maxLength={160} className="input" />
      </label>
      <label className="field-label">
        {s.body}
        <textarea name="body" required minLength={5} maxLength={5000} rows={5} className="input h-auto py-2" />
      </label>
      <label className="field-label">
        {s.priority}
        <select name="priority" defaultValue="MEDIUM" className="input">
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {s.priorities[p]}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {s.send}
      </button>
    </form>
  );
}
