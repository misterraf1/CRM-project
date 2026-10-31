"use client";

import { FORM_FIELD_KEYS, type FormFieldKey, type MemberDto, type WebFormDto, type WebFormInput } from "@/shared";
import clsx from "clsx";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { CopyField } from "./CopyField";

type Draft = WebFormInput & { id?: string };

/** Website forms: build one, put its link or iframe on the site, see the enquiries. */
export function FormsManager({ forms: initial, members, origin }: { forms: WebFormDto[]; members: MemberDto[]; origin: string }) {
  const { t, locale } = useI18n();
  const k = t.forms;
  const [forms, setForms] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const blank = (): Draft => ({
    name: k.defaults.name,
    title: k.defaults.title,
    fields: [
      { key: "name", label: k.fieldLabels.name, required: true },
      { key: "phone", label: k.fieldLabels.phone, required: true },
      { key: "email", label: k.fieldLabels.email, required: false },
      { key: "message", label: k.fieldLabels.message, required: false },
    ],
    successMessage: k.defaults.success,
    assigneeIds: [],
    createDeal: false,
    active: true,
  });

  function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const { id, ...body } = draft;
    startTransition(async () => {
      setError(undefined);
      const res = id ? await api<WebFormDto>(`/forms/${id}`, "PATCH", body) : await api<WebFormDto>("/forms", "POST", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setForms((all) => (id ? all.map((f) => (f.id === id ? res.data : f)) : [res.data, ...all]));
      setDraft(null);
    });
  }

  function remove(f: WebFormDto) {
    if (!window.confirm(interpolate(k.confirmDelete, { name: f.name }))) return;
    startTransition(async () => {
      const res = await api(`/forms/${f.id}`, "DELETE");
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setForms((all) => all.filter((x) => x.id !== f.id));
    });
  }

  const field = (key: FormFieldKey) => draft?.fields.find((f) => f.key === key);
  const setField = (key: FormFieldKey, patch: Partial<{ on: boolean; label: string; required: boolean }>) => {
    if (!draft) return;
    const cur = field(key);
    let fields = draft.fields;
    if (patch.on === false) fields = fields.filter((f) => f.key !== key);
    else if (patch.on === true && !cur) fields = [...fields, { key, label: k.fieldLabels[key], required: false }];
    else fields = fields.map((f) => (f.key === key ? { ...f, ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.required !== undefined ? { required: patch.required } : {}) } : f));
    setDraft({ ...draft, fields: FORM_FIELD_KEYS.flatMap((x) => fields.filter((f) => f.key === x)) });
  };

  return (
    <div className="space-y-4" aria-busy={pending}>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {!draft && (
        <button type="button" onClick={() => setDraft(blank())} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden />
          {k.new}
        </button>
      )}
      {draft && (
        <form onSubmit={save} className="card space-y-4 p-5" aria-label={draft.id ? draft.name : k.new}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field-label">
              {k.name}
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required minLength={2} maxLength={100} className="input" />
            </label>
            <label className="field-label">
              {k.formTitle}
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required minLength={2} maxLength={150} className="input" />
            </label>
          </div>
          <fieldset>
            <legend className="text-xs font-medium text-fg-muted">{k.fields}</legend>
            <div className="mt-2 space-y-2">
              {FORM_FIELD_KEYS.map((key) => {
                const f = field(key);
                return (
                  <div key={key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
                    <label className="flex w-28 items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={!!f} onChange={(e) => setField(key, { on: e.target.checked })} />
                      {k.fieldLabels[key]}
                    </label>
                    {f && (
                      <>
                        <input value={f.label} onChange={(e) => setField(key, { label: e.target.value })} aria-label={`${k.label}: ${k.fieldLabels[key]}`} maxLength={80} className="input mt-0 h-8 min-w-0 flex-1" />
                        <label className="flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={f.required} onChange={(e) => setField(key, { required: e.target.checked })} />
                          {k.required}
                        </label>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
          <label className="field-label">
            {k.successMessage}
            <input value={draft.successMessage} onChange={(e) => setDraft({ ...draft, successMessage: e.target.value })} required minLength={2} maxLength={300} className="input" />
          </label>
          <fieldset>
            <legend className="text-xs font-medium text-fg-muted">{k.assignees}</legend>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
              {members
                .filter((m) => m.status === "ACTIVE")
                .map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.assigneeIds.includes(m.id)}
                      onChange={(e) => setDraft({ ...draft, assigneeIds: e.target.checked ? [...draft.assigneeIds, m.id] : draft.assigneeIds.filter((x) => x !== m.id) })}
                    />
                    <span className="truncate">{m.fullName}</span>
                  </label>
                ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.createDeal} onChange={(e) => setDraft({ ...draft, createDeal: e.target.checked })} />
              {k.createDeal}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              {k.active}
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary">
              {k.save}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="btn-ghost">
              {k.cancel}
            </button>
          </div>
        </form>
      )}

      {forms.length === 0 && !draft ? (
        <p className="card p-6 text-sm text-fg-muted">{k.empty}</p>
      ) : (
        <ul className="space-y-3">
          {forms.map((f) => {
            const link = `${origin}/f/${f.key}`;
            return (
              <li key={f.id} className={clsx("card space-y-3 p-4", !f.active && "opacity-70")}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {f.name}
                      {!f.active && <span className="ml-2 rounded-full bg-muted px-1.5 text-[10px] text-fg-subtle">{k.inactive}</span>}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {interpolate(k.submissions, { n: f.submissions })}
                      {f.lastSubmissionAt && ` · ${interpolate(k.last, { date: formatDateTime(f.lastSubmissionAt, locale) })}`}
                    </p>
                  </div>
                  <a href={link} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-fg-muted hover:bg-muted">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    {k.open}
                  </a>
                  <button type="button" onClick={() => setDraft({ ...f })} aria-label={`${t.automations.edit}: ${f.name}`} className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-muted">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" disabled={pending} onClick={() => remove(f)} aria-label={`${k.delete}: ${f.name}`} className="grid h-8 w-8 place-items-center rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <CopyField label={k.link} value={link} copy={k.copy} copied={k.copied} />
                  <CopyField label={k.embed} value={`<iframe src="${link}" style="width:100%;max-width:520px;height:560px;border:0" title="${f.title.replace(/"/g, "")}"></iframe>`} copy={k.copy} copied={k.copied} multiline />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
