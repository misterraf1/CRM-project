"use client";

import { FIELD_TYPES, OBJECT_ICONS, type CustomObjectDto, type FieldType, type ObjectIcon } from "@/shared";
import clsx from "clsx";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { OBJECT_ICON } from "@/lib/object-icons";

interface FieldRow {
  key: string;
  id?: string;
  label: string;
  type: FieldType;
  options: string;
  required: boolean;
}

interface Draft {
  id?: string;
  name: string;
  singular: string;
  icon: ObjectIcon;
  fields: FieldRow[];
}

const blank = (): Draft => ({ name: "", singular: "", icon: "box", fields: [{ key: crypto.randomUUID(), label: "", type: "text", options: "", required: false }] });
const draftOf = (o: CustomObjectDto): Draft => ({
  id: o.id,
  name: o.name,
  singular: o.singular,
  icon: o.icon,
  fields: o.fields.map((f) => ({ key: f.id, id: f.id, label: f.label, type: f.type, options: f.options.join(", "), required: f.required })),
});

/** The company's own sections: name, menu icon and fields. */
export function ObjectsManager({ initial }: { initial: CustomObjectDto[] }) {
  const { t } = useI18n();
  const k = t.objects;
  const types = t.crmSettings.fields.types;
  const router = useRouter();
  const [objects, setObjects] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const setField = (key: string, patch: Partial<FieldRow>) => setDraft((d) => d && { ...d, fields: d.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) });

  const save = () =>
    draft &&
    startTransition(async () => {
      setError(undefined);
      const body = {
        name: draft.name.trim(),
        singular: draft.singular.trim(),
        icon: draft.icon,
        fields: draft.fields
          .filter((f) => f.label.trim())
          .map((f) => ({ id: f.id, label: f.label.trim(), type: f.type, required: f.required, options: f.type === "select" || f.type === "multiselect" ? f.options.split(",").map((o) => o.trim()).filter(Boolean) : [] })),
      };
      const res = draft.id ? await api<CustomObjectDto>(`/objects/${draft.id}`, "PATCH", body) : await api<CustomObjectDto>("/objects", "POST", body);
      if (!res.ok) return setError(errorMessage(t, res.code));
      setObjects((all) => (draft.id ? all.map((o) => (o.id === draft.id ? res.data : o)) : [...all, res.data]));
      setDraft(null);
      router.refresh();
    });

  const remove = (o: CustomObjectDto) =>
    window.confirm(interpolate(k.confirmRemove, { name: o.name })) &&
    startTransition(async () => {
      setError(undefined);
      const res = await api<CustomObjectDto[]>(`/objects/${o.id}`, "DELETE");
      if (!res.ok) return setError(res.code === "CONFLICT" ? k.notEmpty : errorMessage(t, res.code));
      setObjects(res.data);
      router.refresh();
    });

  return (
    <section className="card space-y-4 p-5" aria-labelledby="objects-title" aria-busy={pending}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="objects-title" className="text-sm font-semibold">
            {k.manageTitle}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-fg-muted">{k.manageSubtitle}</p>
        </div>
        {!draft && (
          <button type="button" onClick={() => setDraft(blank())} className="btn-primary h-9 text-sm">
            <Plus className="h-4 w-4" aria-hidden />
            {k.create}
          </button>
        )}
      </div>

      {objects.length === 0 && !draft && <p className="text-sm text-fg-muted">{k.empty}</p>}
      {objects.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {objects.map((o) => {
            const Icon = OBJECT_ICON[o.icon];
            return (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{o.name}</p>
                  <p className="text-xs text-fg-muted">
                    {interpolate(k.records, { n: o.records })} · {o.fields.map((f) => f.label).join(", ") || "—"}
                  </p>
                </div>
                <button type="button" onClick={() => setDraft(draftOf(o))} aria-label={`${k.edit}: ${o.name}`} className="btn-ghost h-8 gap-1 px-2 text-xs">
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  {k.edit}
                </button>
                <button type="button" onClick={() => remove(o)} aria-label={`${k.remove}: ${o.name}`} className="grid h-8 w-8 place-items-center rounded-md text-danger hover:bg-danger/10">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {draft && (
        <div className="space-y-4 rounded-xl border border-accent/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-xs font-medium text-fg-muted">{k.name}</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={40} placeholder={k.namePlaceholder} className="input mt-1" />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-fg-muted">{k.singular}</span>
              <input value={draft.singular} onChange={(e) => setDraft({ ...draft, singular: e.target.value })} maxLength={40} placeholder={k.singularPlaceholder} className="input mt-1" />
            </label>
          </div>
          <fieldset>
            <legend className="text-xs font-medium text-fg-muted">{k.icon}</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {OBJECT_ICONS.map((icon) => {
                const Icon = OBJECT_ICON[icon];
                return (
                  <button key={icon} type="button" aria-pressed={draft.icon === icon} aria-label={icon} onClick={() => setDraft({ ...draft, icon })} className={clsx("grid h-9 w-9 place-items-center rounded-lg border", draft.icon === icon ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-muted hover:bg-muted")}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-fg-muted">{k.fields}</legend>
            {draft.fields.map((f) => (
              <div key={f.key} className="grid gap-2 rounded-lg bg-muted/40 p-2 sm:grid-cols-[minmax(0,1fr)_170px_auto_auto]">
                <input value={f.label} onChange={(e) => setField(f.key, { label: e.target.value })} maxLength={60} placeholder={k.fieldLabel} aria-label={k.fieldLabel} className="input mt-0" />
                <select value={f.type} disabled={!!f.id} onChange={(e) => setField(f.key, { type: e.target.value as FieldType })} aria-label={k.fieldType} className="input mt-0">
                  {FIELD_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {types[x]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={f.required} onChange={(e) => setField(f.key, { required: e.target.checked })} className="h-4 w-4" />
                  {k.required}
                </label>
                <button type="button" onClick={() => setDraft({ ...draft, fields: draft.fields.filter((x) => x.key !== f.key) })} aria-label={`${k.removeField}: ${f.label}`} className="grid h-9 w-9 place-items-center rounded-md text-fg-subtle hover:bg-muted">
                  <X className="h-4 w-4" aria-hidden />
                </button>
                {(f.type === "select" || f.type === "multiselect") && (
                  <input value={f.options} onChange={(e) => setField(f.key, { options: e.target.value })} placeholder={k.options} aria-label={k.options} className="input mt-0 sm:col-span-4" />
                )}
              </div>
            ))}
            <button type="button" onClick={() => setDraft({ ...draft, fields: [...draft.fields, { key: crypto.randomUUID(), label: "", type: "text", options: "", required: false }] })} className="btn-ghost h-8 border border-dashed border-border text-xs">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {k.addField}
            </button>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={pending || !draft.name.trim() || !draft.singular.trim()} className="btn-primary">
              {draft.id ? k.save : k.create}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="btn-ghost">
              {k.cancel}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}
