"use client";

import { CASE_STATUSES, PRIORITIES, type CaseDto, type CaseStatus, type MemberDto } from "@/shared";
import clsx from "clsx";
import { ShieldCheck, ShieldX } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { formatDate, formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { CaseStatusBadge } from "./CaseBadges";

/** A case: its state, who handles it, the warranty, internal notes and the resolution. */
export function CaseView({ initial, members, canAssign }: { initial: CaseDto; members: MemberDto[]; canAssign: boolean }) {
  const { t, locale } = useI18n();
  const k = t.cases;
  const f = k.fields;
  // The API's answer applies at once
  const [c, setC] = useState(initial);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const patch = (body: object) =>
    startTransition(async () => {
      setError(undefined);
      setSaved(false);
      const res = await api<CaseDto>(`/cases/${c.id}`, "PATCH", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setC(res.data);
      setSaved(true);
    });

  function addNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) return;
    startTransition(async () => {
      setError(undefined);
      const res = await api<CaseDto>(`/cases/${c.id}/notes`, "POST", { body });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setC(res.data);
      form.reset();
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" aria-busy={pending}>
      <div className="space-y-5">
        <section className="card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-xs text-fg-subtle">{c.number}</span>
            <CaseStatusBadge status={c.status} label={k.statuses[c.status]} />
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-fg-muted">{k.types[c.type]}</span>
            {c.overdue && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">{k.overdue}</span>}
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">{c.subject}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            <Link href={`/crm/${c.contact.id}`} className="font-medium text-accent hover:underline">
              {c.contact.name}
            </Link>
            {c.order && (
              <>
                {" · "}
                <Link href={`/orders/${c.order.id}`} className="hover:underline">
                  {c.order.number} · {c.order.title}
                </Link>
              </>
            )}
          </p>
          {c.description && <p className="mt-4 whitespace-pre-wrap text-sm">{c.description}</p>}
          {c.order && (
            <p className={clsx("mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm", c.warranty?.valid ? "bg-success/10 text-success" : "bg-muted text-fg-muted")}>
              {c.warranty?.valid ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <ShieldX className="h-4 w-4" aria-hidden />}
              {c.warranty ? interpolate(c.warranty.valid ? k.warrantyValid : k.warrantyExpired, { date: formatDate(c.warranty.until, locale, "long") }) : k.noWarranty}
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="case-notes">
          <h2 id="case-notes" className="px-5 pt-4 text-sm font-semibold">
            {k.notes}
          </h2>
          {c.notes.length === 0 ? (
            <p className="px-5 py-3 text-sm text-fg-muted">{k.noNotes}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border border-t border-border">
              {c.notes.map((n) => (
                <li key={n.id} className="px-5 py-3 text-sm">
                  <p className="text-xs text-fg-subtle">
                    {n.author?.name ?? "—"} · {formatDateTime(n.at, locale)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addNote} className="flex gap-2 border-t border-border p-3">
            <label className="sr-only" htmlFor="case-note">
              {k.notes}
            </label>
            <input id="case-note" name="body" maxLength={5000} placeholder={k.notePlaceholder} className="input mt-0 flex-1" />
            <button type="submit" disabled={pending} className="btn-primary">
              {k.addNote}
            </button>
          </form>
        </section>
      </div>

      <aside className="space-y-5">
        <section className="card space-y-3 p-5">
          <label className="field-label">
            {f.status}
            <select value={c.status} disabled={!c.canEdit || pending} onChange={(e) => patch({ status: e.target.value as CaseStatus })} className="input mt-1">
              {CASE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {k.statuses[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            {f.priority}
            <select value={c.priority} disabled={!c.canEdit || pending} onChange={(e) => patch({ priority: e.target.value })} className="input mt-1">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t.dashboard.tasks.priority[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            {f.assignee}
            <select value={c.assignee?.id ?? ""} disabled={!c.canEdit || !canAssign || pending} onChange={(e) => patch({ assigneeId: e.target.value || null })} className="input mt-1">
              <option value="">{t.crm.unassigned}</option>
              {members
                .filter((m) => m.status === "ACTIVE" || m.id === c.assignee?.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
            </select>
          </label>
          <p className="text-sm">
            <span className="text-fg-muted">{f.due}: </span>
            <span className={clsx(c.overdue && "font-medium text-danger")}>{formatDateTime(c.dueAt, locale)}</span>
          </p>
          <p className="text-xs text-fg-subtle">{k.slaHint}</p>
        </section>
        <section className="card space-y-2 p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              patch({ resolution: String(new FormData(e.currentTarget).get("resolution") ?? "").trim() || null });
            }}
            className="space-y-2"
          >
            <label className="field-label">
              {f.resolution}
              <textarea name="resolution" rows={4} maxLength={5000} defaultValue={c.resolution ?? ""} disabled={!c.canEdit} className="input mt-1" />
            </label>
            {c.canEdit && (
              <button type="submit" disabled={pending} className="btn-ghost border border-border">
                {k.save}
              </button>
            )}
          </form>
          {c.resolvedAt && <p className="text-xs text-fg-subtle">{formatDateTime(c.resolvedAt, locale)}</p>}
        </section>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-success">
            {t.notificationPrefs.saved}
          </p>
        )}
      </aside>
    </div>
  );
}
