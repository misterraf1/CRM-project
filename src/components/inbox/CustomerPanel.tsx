"use client";

import { LIFECYCLE_STAGES, type ActivityDto, type ContactDetailDto, type ConversationDetailDto, type DepartmentDto, type MemberDto, type TaskDto } from "@/shared";
import clsx from "clsx";
import { CalendarDays, Check, CheckSquare, ChevronDown, Copy, Handshake, Mail, MessageCircle, Pencil, Phone, Plus, StickyNote, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { api } from "@/lib/api/client";
import { formatDate, formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

/** A collapsible card of the customer panel; the summary keeps its title and count. */
function Section({ title, icon, count, open = false, children }: { title: string; icon: ReactNode; count?: number; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-fg-muted">{icon}</span>
        <span className="flex-1 text-sm font-semibold">{title}</span>
        {count !== undefined && <span className="tabular rounded-full bg-muted px-2 text-[11px] font-semibold leading-5 text-fg-muted">{count}</span>}
        <ChevronDown className="h-4 w-4 text-fg-subtle transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}

export function CustomerPanel({
  conversation: c,
  members,
  departments,
  contact,
  notes,
  tasks,
}: {
  conversation: ConversationDetailDto;
  members: MemberDto[];
  departments: DepartmentDto[];
  contact: ContactDetailDto | null;
  notes: ActivityDto[];
  tasks: TaskDto[];
}) {
  const { t, locale } = useI18n();
  const k = t.inbox;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; code?: string }>, after?: () => void) =>
    startTransition(async () => {
      setError(undefined);
      const res = await fn();
      if (!res.ok) setError(errorMessage(t, res.code));
      else after?.();
      router.refresh();
    });

  const name = contact?.name ?? (c.displayName || k.visitor);
  const handlePhone = /^\+?[\d\s()-]{7,}$/.test(c.handle) ? c.handle : null;
  const phone = contact?.phone ?? handlePhone;
  const digits = phone?.replace(/\D/g, "") ?? "";
  const email = contact?.email ?? (c.channel.type === "EMAIL" ? c.handle : null);
  const started = c.messages[0]?.createdAt;
  const row = "grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 text-sm";
  const pick = "h-8 w-full rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:border-accent disabled:opacity-60";
  const action = "grid h-10 flex-1 place-items-center rounded-xl border border-border bg-surface transition-colors hover:bg-muted";

  return (
    <div className="space-y-3 p-3" aria-busy={pending}>
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <Avatar name={name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{name}</h2>
            {phone ? (
              <p className="mt-0.5 flex items-center gap-1 text-sm text-fg-muted">
                <span className="truncate">{phone}</span>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(phone).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
                  aria-label={copied ? k.copied : k.copy}
                  title={copied ? k.copied : k.copy}
                  className="grid h-6 w-6 place-items-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </p>
            ) : (
              c.handle && <p className="mt-0.5 truncate text-sm text-fg-muted">{c.handle}</p>
            )}
          </div>
          {contact && (
            <Link href={`/crm/${contact.id}`} aria-label={k.openCard} title={k.openCard} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-muted hover:text-fg">
              <Pencil className="h-4 w-4" />
            </Link>
          )}
        </div>
        {(phone || email) && (
          <div className="mt-3 flex gap-2">
            {digits && (
              <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" aria-label={k.openWhatsApp} title={k.openWhatsApp} className={action}>
                <MessageCircle className="h-5 w-5 text-[#15803d] dark:text-success" />
              </a>
            )}
            {phone && (
              <a href={`tel:${phone.replace(/[\s()-]/g, "")}`} aria-label={k.call} title={k.call} className={action}>
                <Phone className="h-5 w-5 text-fg-muted" />
              </a>
            )}
            {email && (
              <a href={`mailto:${email}`} aria-label={k.writeEmail} title={k.writeEmail} className={action}>
                <Mail className="h-5 w-5 text-fg-muted" />
              </a>
            )}
          </div>
        )}
        {c.contact ? (
          <Link href={`/crm/${c.contact.id}`} className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
            {k.openCard} →
          </Link>
        ) : (
          <div className="mt-3 rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-fg-muted">{k.notInCrm}</p>
            <button type="button" disabled={pending} onClick={() => run(() => api(`/inbox/conversations/${c.id}/contact`, "POST", {}))} className="btn-primary mt-2 h-8 text-xs">
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              {k.addToCrm}
            </button>
          </div>
        )}
      </section>

      <Section title={k.crmInfo} icon={<Handshake className="h-4 w-4" />} open>
        <div className="space-y-2.5">
          {contact && (
            <label className={row}>
              <span className="text-fg-muted">{k.stage}</span>
              <select
                value={contact.stage}
                disabled={pending}
                onChange={(e) => run(() => api(`/contacts/${contact.id}`, "PATCH", { stage: e.target.value }))}
                className={clsx(pick, "bg-accent-soft font-medium text-accent")}
              >
                {LIFECYCLE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t.crm.stages[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={row}>
            <span className="text-fg-muted">{k.owner}</span>
            <select
              aria-label={k.assignee}
              value={c.assignee?.id ?? ""}
              disabled={!c.can.assign || pending}
              onChange={(e) => run(() => api(`/inbox/conversations/${c.id}`, "PATCH", { assigneeId: e.target.value || null }))}
              className={pick}
            >
              <option value="">{k.unassigned}</option>
              {members
                .filter((m) => m.status === "ACTIVE" || m.id === c.assignee?.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
            </select>
          </label>
          {departments.length > 0 && (
            <label className={row}>
              <span className="text-fg-muted">{k.department}</span>
              <select
                value={c.departmentId ?? ""}
                disabled={!c.can.assign || pending}
                onChange={(e) => run(() => api(`/inbox/conversations/${c.id}`, "PATCH", { departmentId: e.target.value || null }))}
                className={pick}
              >
                <option value="">{k.noDepartment}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className={row}>
            <span className="text-fg-muted">{k.source}</span>
            <span className="flex min-w-0 items-center gap-2">
              <ChannelIcon channel={c.channel.type} label={t.channels.types[c.channel.type]} size="sm" />
              <span className="truncate">{t.channels.types[c.channel.type]}</span>
            </span>
          </div>
          {started && (
            <div className={row}>
              <span className="text-fg-muted">{k.started}</span>
              <span className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-fg-subtle" aria-hidden />
                {formatDateTime(started, locale)}
              </span>
            </div>
          )}
          {c.firstResponseMs !== null && (
            <div className={row}>
              <span className="text-fg-muted">{k.avgLabel}</span>
              <span>{formatDuration(c.firstResponseMs / 60000, locale)}</span>
            </div>
          )}
        </div>
      </Section>

      {contact && (
        <Section title={k.notes} icon={<StickyNote className="h-4 w-4" />} count={notes.length} open>
          {notes.length === 0 && !writing && <p className="text-xs text-fg-muted">{k.noNotes}</p>}
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg bg-muted/60 px-3 py-2">
                <p className="line-clamp-4 whitespace-pre-wrap text-sm">{String(n.payload.body ?? "")}</p>
                <p className="mt-1 text-[11px] text-fg-subtle">
                  {formatDateTime(n.createdAt, locale)}
                  {n.actor && ` · ${n.actor.name}`}
                </p>
              </li>
            ))}
          </ul>
          {writing ? (
            <form
              className="mt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!note.trim()) return;
                run(() => api(`/contacts/${contact.id}/notes`, "POST", { body: note.trim() }), () => (setNote(""), setWriting(false)));
              }}
            >
              <label className="sr-only" htmlFor="card-note">
                {k.writeNote}
              </label>
              <textarea id="card-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={5000} placeholder={k.notePlaceholderCard} className="block w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent" autoFocus />
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setWriting(false)} className="btn-ghost h-8 text-xs">
                  {t.members.cancel}
                </button>
                <button type="submit" disabled={pending || !note.trim()} className="btn-primary h-8 text-xs">
                  {k.saveNote}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setWriting(true)} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-accent-soft/60 text-sm font-medium text-accent hover:bg-accent-soft">
              <Plus className="h-4 w-4" aria-hidden />
              {k.writeNote}
            </button>
          )}
        </Section>
      )}

      {contact && (
        <Section title={t.nav.tasks} icon={<CheckSquare className="h-4 w-4" />} count={tasks.length}>
          {tasks.length === 0 ? (
            <p className="text-xs text-fg-muted">{k.noTasks}</p>
          ) : (
            <ul className="space-y-1">
              {tasks.slice(0, 8).map((task) => (
                <li key={task.id}>
                  <Link href={`/tasks/${task.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    {task.dueAt && <span className={clsx("shrink-0 text-[11px]", new Date(task.dueAt) < new Date() ? "font-medium text-danger" : "text-fg-subtle")}>{formatDate(task.dueAt, locale)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {contact && (
        <Section title={t.nav.deals} icon={<Handshake className="h-4 w-4" />} count={contact.deals.length}>
          {contact.deals.length === 0 ? (
            <p className="text-xs text-fg-muted">{k.noDeals}</p>
          ) : (
            <ul className="space-y-1">
              {contact.deals.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <Link href={`/deals/${d.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    <span className="tabular shrink-0 text-xs font-medium">{formatMoney(d.amount, locale, d.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {error && <p role="alert" className="px-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
