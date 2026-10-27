"use client";

import { TICKET_PRIORITIES, TICKET_STATUSES, type TicketDto } from "@/shared";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { adminApi, api } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

/**
 * A support ticket's conversation. `staff`: platform console (status/priority,
 * replies as platform support); otherwise the company's own view.
 */
export function TicketThread({ ticket, staff }: { ticket: TicketDto; staff: boolean }) {
  const { t, locale } = useI18n();
  const k = t.admin.tickets;
  const s = t.support;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const call = staff ? adminApi : api;
  const base = staff ? `/tickets/${ticket.id}` : `/support/tickets/${ticket.id}`;

  const run = (fn: () => ReturnType<typeof api>, onOk?: () => void) =>
    startTransition(async () => {
      setError(undefined);
      const res = await fn();
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      onOk?.();
      router.refresh();
    });

  function reply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get("body")).trim();
    if (!body) return;
    run(() => call(`${base}/messages`, "POST", { body }), () => form.reset());
  }

  return (
    <div className="space-y-4" aria-busy={pending}>
      {staff && (
        <div className="flex flex-wrap gap-3">
          <label className="field-label">
            {k.status}
            <select value={ticket.status} disabled={pending} onChange={(e) => run(() => adminApi(base, "PATCH", { status: e.target.value }))} className="input w-auto">
              {TICKET_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {k.statuses[v]}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            {k.priority}
            <select value={ticket.priority} disabled={pending} onChange={(e) => run(() => adminApi(base, "PATCH", { priority: e.target.value }))} className="input w-auto">
              {TICKET_PRIORITIES.map((v) => (
                <option key={v} value={v}>
                  {k.priorities[v]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <ol className="space-y-3">
        {ticket.messages?.map((m) => (
          <li key={m.id} className={clsx("max-w-[85%] rounded-xl border px-4 py-3", m.fromStaff ? "ml-auto border-accent/30 bg-accent-soft/60" : "border-border bg-surface")}>
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="font-semibold">{m.fromStaff && !staff ? s.staff : m.author}</span>
              {m.fromStaff && staff && <span className="text-accent">{s.staff}</span>}
              <span className="text-fg-subtle">{formatDateTime(m.createdAt, locale)}</span>
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <form onSubmit={reply} className="card p-3">
        <label className="sr-only" htmlFor="ticket-reply">
          {k.reply}
        </label>
        <textarea id="ticket-reply" name="body" rows={3} required maxLength={5000} placeholder={k.reply} className="input h-auto py-2" />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[11px] text-fg-subtle">{staff ? k.staffNote : ticket.status === "closed" ? s.reopenHint : ""}</p>
          <button type="submit" disabled={pending} className="btn-primary">
            {k.send}
          </button>
        </div>
      </form>
    </div>
  );
}
