"use client";

import { CALL_OUTCOMES, EVENT_KINDS, REMINDER_MINUTES, type CalendarEventDto, type EventKind, type EventOutcome, type MemberDto } from "@/shared";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { RECURRENCE_OPTIONS } from "@/components/tasks/meta";
import { api } from "@/lib/api/client";
import { addDaysKey, dayKey, dayStart } from "@/lib/calendar";
import { fromDateTimeInput, toDateTimeInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { useHydrated } from "@/lib/use-hydrated";
import { ContactCombobox } from "./ContactCombobox";

export interface EventDraft {
  startAt: string;
  endAt: string;
  allDay?: boolean;
  contact?: { id: string; name: string } | null;
  kind?: EventKind;
}

interface Props {
  /** An existing event (edit) or a draft (new) */
  event: CalendarEventDto | null;
  draft: EventDraft;
  members: MemberDto[];
  meId: string;
  canAssign: boolean;
  onClose: () => void;
  /** The saved event, or null with the id when it was deleted */
  onSaved: (saved: CalendarEventDto | null, deletedId?: string) => void;
}

/** Create or edit a meeting/call; for existing ones also record how it went. */
export function EventDialog({ event, draft, members, meId, canAssign, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const k = t.calendar;
  const f = k.fields;
  const ref = useRef<HTMLDialogElement>(null);
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const editable = !event || event.canEdit;

  const [allDay, setAllDay] = useState(event?.allDay ?? draft.allDay ?? false);
  const [contact, setContact] = useState(event?.contact ?? draft.contact ?? null);
  const [attendees, setAttendees] = useState<string[]>(event?.attendees.map((a) => a.id) ?? []);
  const [ownerId, setOwnerId] = useState(event?.owner?.id ?? meId);
  const startIso = event?.startAt ?? draft.startAt;
  const endIso = event?.endAt ?? draft.endAt;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const send = (fn: () => ReturnType<typeof api<CalendarEventDto>>, deletedId?: string) =>
    startTransition(async () => {
      setError(undefined);
      const res = await fn();
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      onSaved(deletedId ? null : res.data, deletedId);
    });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (n: string) => String(form.get(n) ?? "");
    const startAt = allDay ? dayStart(get("startDay")) : fromDateTimeInput(get("start"));
    // An all-day event ends at the end of its last day
    const endAt = allDay ? new Date(new Date(dayStart(addDaysKey(get("endDay") || get("startDay"), 1))).getTime() - 60_000).toISOString() : fromDateTimeInput(get("end"));
    if (!startAt || !endAt) return setError(errorMessage(t, "VALIDATION_FAILED"));
    const reminder = get("reminder");
    const body = {
      title: get("title"),
      kind: get("kind"),
      startAt,
      endAt,
      allDay,
      location: get("location") || null,
      description: get("description") || null,
      contactId: contact?.id ?? null,
      ownerId,
      attendeeIds: attendees,
      recurrence: get("recurrence") || null,
      reminderMinutes: reminder ? Number(reminder) : null,
    };
    send(() => (event ? api<CalendarEventDto>(`/calendar/events/${event.id}`, "PATCH", body) : api<CalendarEventDto>("/calendar/events", "POST", body)));
  }

  const others = members.filter((m) => m.status === "ACTIVE" && m.id !== ownerId);

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="event-dialog-title" className="w-[min(94vw,560px)] rounded-xl border border-border bg-surface p-0 text-fg backdrop:bg-black/40">
      <form onSubmit={submit} className="max-h-[85vh] space-y-3 overflow-y-auto p-5" aria-busy={pending}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="event-dialog-title" className="text-base font-semibold">
            {event ? event.title : k.newEvent}
          </h2>
          {event?.recurrence && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-fg-muted">{k.repeats}</span>}
        </div>
        {!editable && <p className="rounded-lg bg-muted px-3 py-2 text-xs text-fg-muted">{k.readOnly}</p>}
        <fieldset disabled={!editable || pending} className="space-y-3">
          <label className="field-label">
            {f.title}
            <input name="title" required maxLength={200} defaultValue={event?.title ?? ""} autoFocus className="input mt-1" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field-label">
              {f.kind}
              <select name="kind" defaultValue={event?.kind ?? draft.kind ?? "meeting"} className="input mt-1">
                {EVENT_KINDS.map((x) => (
                  <option key={x} value={x}>
                    {k.kinds[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              {f.allDay}
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {allDay ? (
              <>
                <label className="field-label">
                  {f.start}
                  <input type="date" name="startDay" required defaultValue={dayKey(startIso)} className="input mt-1" />
                </label>
                <label className="field-label">
                  {f.end}
                  <input type="date" name="endDay" defaultValue={dayKey(endIso)} className="input mt-1" />
                </label>
              </>
            ) : (
              <>
                <label className="field-label">
                  {f.start}
                  <input type="datetime-local" name="start" required defaultValue={toDateTimeInput(startIso)} className="input mt-1" />
                </label>
                <label className="field-label">
                  {f.end}
                  <input type="datetime-local" name="end" required defaultValue={toDateTimeInput(endIso)} className="input mt-1" />
                </label>
              </>
            )}
          </div>
          <ContactCombobox label={f.contact} placeholder={k.noContact} value={contact} onChange={setContact} />
          <label className="field-label">
            {f.location}
            <input name="location" maxLength={300} defaultValue={event?.location ?? ""} className="input mt-1" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field-label">
              {f.recurrence}
              <select name="recurrence" defaultValue={event?.recurrence ?? ""} className="input mt-1">
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.key} value={o.value}>
                    {t.tasks.recurrences[o.key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              {f.reminder}
              <select name="reminder" defaultValue={event?.reminderMinutes != null ? String(event.reminderMinutes) : "15"} className="input mt-1">
                <option value="">{k.reminders.none}</option>
                {REMINDER_MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {k.reminders[String(m) as keyof typeof k.reminders]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {canAssign && (
            <label className="field-label">
              {f.owner}
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="input mt-1">
                {members
                  .filter((m) => m.status === "ACTIVE")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {others.length > 0 && (
            <fieldset>
              <legend className="field-label">{f.attendees}</legend>
              <div className="mt-1 grid max-h-32 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
                {others.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={attendees.includes(m.id)}
                      onChange={(e) => setAttendees((a) => (e.target.checked ? [...a, m.id] : a.filter((x) => x !== m.id)))}
                    />
                    <span className="truncate">{m.fullName}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="field-label">
            {f.description}
            <textarea name="description" rows={3} maxLength={5000} defaultValue={event?.description ?? ""} className="input mt-1" />
          </label>
          {event?.recurrence && <p className="text-xs text-fg-subtle">{k.seriesHint}</p>}
        </fieldset>

        {event && editable && <OutcomePicker event={event} disabled={pending} onPick={(outcome) => send(() => api<CalendarEventDto>(`/calendar/events/${event.id}/outcome`, "POST", { outcome }))} />}

        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          {event && editable ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => window.confirm(interpolate(k.confirmDelete, { title: event.title })) && send(() => api<CalendarEventDto>(`/calendar/events/${event.id}`, "DELETE"), event.id)}
              className="btn-ghost text-danger"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {k.delete}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              {editable ? k.cancel : k.close}
            </button>
            {editable && (
              <button type="submit" disabled={pending || !hydrated} className="btn-primary">
                {k.save}
              </button>
            )}
          </div>
        </div>
      </form>
    </dialog>
  );
}

function OutcomePicker({ event, disabled, onPick }: { event: CalendarEventDto; disabled: boolean; onPick: (o: EventOutcome) => void }) {
  const { t } = useI18n();
  const k = t.calendar;
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium text-fg-muted">{k.setOutcome}</legend>
      <div className="flex flex-wrap gap-1.5">
        {CALL_OUTCOMES.map((o) => (
          <button
            key={o}
            type="button"
            disabled={disabled}
            aria-pressed={event.outcome === o}
            onClick={() => onPick(o)}
            className={`rounded-full border px-2.5 py-1 text-xs ${event.outcome === o ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-muted hover:bg-muted"}`}
          >
            {k.outcomes[o]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
