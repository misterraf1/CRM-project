"use client";

import { CALL_OUTCOMES, type CalendarEventDto, type EventOutcome } from "@/shared";
import clsx from "clsx";
import { CalendarPlus, Phone, PhoneIncoming, PhoneOutgoing, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { dayKey } from "@/lib/calendar";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { useHydrated } from "@/lib/use-hydrated";

/** Contact card: the call log and meetings, with a quick "log a call" form. */
export function ContactCalls({ contact, events: initial, canLog }: { contact: { id: string; name: string; phone: string | null }; events: CalendarEventDto[]; canLog: boolean }) {
  const { t, locale } = useI18n();
  const k = t.calendar;
  const router = useRouter();
  const hydrated = useHydrated();
  const [events, setEvents] = useState(initial);
  useEffect(() => setEvents(initial), [initial]);
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      outcome: form.get("outcome") as EventOutcome,
      direction: form.get("direction"),
      durationMin: Number(form.get("duration") || 0),
      note: String(form.get("note") ?? "") || null,
    };
    startTransition(async () => {
      setError(undefined);
      const res = await api<CalendarEventDto>(`/contacts/${contact.id}/calls`, "POST", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setEvents((all) => [res.data, ...all]);
      setLogging(false);
      router.refresh();
    });
  }

  const plan = `/calendar?new=1&contact=${encodeURIComponent(contact.id)}&contactName=${encodeURIComponent(contact.name)}`;

  return (
    <section className="card" aria-labelledby="contact-calls" aria-busy={pending}>
      <header className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h2 id="contact-calls" className="text-sm font-semibold">
          {k.calls.title}
        </h2>
        <div className="flex items-center gap-3 text-xs font-medium">
          {contact.phone && (
            <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-accent hover:underline">
              <Phone className="h-3.5 w-3.5" aria-hidden />
              {contact.phone}
            </a>
          )}
          {canLog && (
            <>
              <button type="button" onClick={() => setLogging((v) => !v)} aria-expanded={logging} className="inline-flex items-center gap-1 text-accent hover:underline">
                <PhoneOutgoing className="h-3.5 w-3.5" aria-hidden />
                {k.calls.log}
              </button>
              <Link href={plan} className="inline-flex items-center gap-1 text-accent hover:underline">
                <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                {k.calls.plan}
              </Link>
            </>
          )}
        </div>
      </header>

      {logging && (
        <form onSubmit={submit} className="mx-5 mt-3 grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
          <label className="field-label">
            {k.outcome}
            <select name="outcome" defaultValue="done" className="input mt-1">
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {k.outcomes[o]}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            {k.calls.direction}
            <select name="direction" defaultValue="outgoing" className="input mt-1">
              <option value="outgoing">{k.calls.directions.outgoing}</option>
              <option value="incoming">{k.calls.directions.incoming}</option>
            </select>
          </label>
          <label className="field-label">
            {k.calls.duration}
            <input name="duration" type="number" min={0} max={600} defaultValue={0} className="input mt-1" />
          </label>
          <label className="field-label sm:col-span-3">
            {k.note}
            <input name="note" maxLength={2000} className="input mt-1" />
          </label>
          <div className="flex justify-end gap-2 sm:col-span-3">
            <button type="button" onClick={() => setLogging(false)} className="btn-ghost">
              {k.cancel}
            </button>
            <button type="submit" disabled={pending || !hydrated} className="btn-primary">
              {k.save}
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mx-5 mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {events.length === 0 ? (
        <p className="px-5 py-4 text-sm text-fg-muted">{k.calls.empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border border-t border-border">
          {events.map((ev) => {
            const Icon = ev.kind !== "call" ? Users : ev.direction === "incoming" ? PhoneIncoming : PhoneOutgoing;
            const minutes = Math.round((new Date(ev.endAt).getTime() - new Date(ev.startAt).getTime()) / 60_000);
            return (
              <li key={ev.id}>
                <Link href={`/calendar?view=day&date=${dayKey(ev.startAt)}&event=${ev.id}`} className="flex items-start gap-3 px-5 py-2.5 text-sm hover:bg-muted">
                  <Icon className={clsx("mt-0.5 h-4 w-4 shrink-0", ev.kind === "call" ? "text-success" : "text-accent")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{ev.kind === "call" ? (ev.direction ? k.calls.directions[ev.direction] : k.kinds.call) : ev.title}</span>
                    {ev.outcomeNote && <span className="block truncate text-xs text-fg-muted">{ev.outcomeNote}</span>}
                  </span>
                  <span className="shrink-0 text-right text-xs text-fg-subtle">
                    {formatDateTime(ev.startAt, locale)}
                    {ev.kind === "call" && minutes > 0 && <span className="block">{interpolate(k.calls.minutes, { n: minutes })}</span>}
                    {ev.outcome && <span className={clsx("block", ev.outcome === "done" ? "text-success" : ev.outcome === "callback" ? "text-warning" : "")}>{k.outcomes[ev.outcome]}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
