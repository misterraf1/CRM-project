"use client";

import { FIELD_ENTITIES, FIELD_TYPES, type FieldDefinitionDto, type FieldEntity, type FieldType } from "@/shared";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { api, type ClientResult } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

const hasOptions = (type: FieldType) => type === "select" || type === "multiselect";
const parseOptions = (text: string) => [...new Set(text.split("\n").map((o) => o.trim()).filter(Boolean))];

/** Custom field definitions per record type: add, edit, archive, reorder. */
export function FieldsManager({ fields: initial }: { fields: FieldDefinitionDto[] }) {
  const { t } = useI18n();
  const k = t.crmSettings.fields;
  const router = useRouter();
  const [entity, setEntity] = useState<FieldEntity>("contact");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  // Each change applies the API's answer at once (a refresh racing the page load could drop it); server data wins on refresh
  const [fields, setFields] = useState(initial);
  useEffect(() => setFields(initial), [initial]);
  const list = fields.filter((f) => f.entity === entity);
  const active = list.filter((f) => !f.archived);

  function run<T>(call: () => Promise<ClientResult<T>>, apply: (data: T) => void) {
    setError(undefined);
    startTransition(async () => {
      const res = await call();
      if (!res.ok) {
        const used = (res.details as { options?: string[] } | undefined)?.options;
        setError(res.code === "CONFLICT" && used ? interpolate(k.optionInUse, { options: used.join(", ") }) : errorMessage(t, res.code));
        return;
      }
      apply(res.data);
      router.refresh();
    });
  }

  const replace = (f: FieldDefinitionDto) => setFields((all) => all.map((x) => (x.id === f.id ? f : x)));

  function move(id: string, dir: -1 | 1) {
    const ids = list.map((f) => f.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    run(
      () => api<FieldDefinitionDto[]>("/fields/reorder", "POST", { entity, ids }),
      (ordered) => setFields((all) => [...all.filter((f) => f.entity !== entity), ...ordered]),
    );
  }

  return (
    <section className="card">
      <div className="px-5 pt-4">
        <h2 className="text-sm font-semibold">{k.title}</h2>
        <p className="mt-1 text-xs text-fg-muted">{k.hint}</p>
        <div role="tablist" aria-label={k.title} className="mt-3 flex w-fit rounded-lg bg-muted p-0.5 text-xs font-medium">
          {FIELD_ENTITIES.map((e) => (
            <button
              key={e}
              type="button"
              role="tab"
              aria-selected={entity === e}
              onClick={() => (setEntity(e), setEditing(null), setAdding(false), setError(undefined))}
              className={clsx("rounded-md px-3 py-1.5", entity === e ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
            >
              {k.entities[e]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mx-5 mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {list.length === 0 ? (
        <p className="px-5 py-5 text-sm text-fg-muted">{k.empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border border-t border-border" aria-busy={pending}>
          {list.map((f) =>
            editing === f.id ? (
              <li key={f.id} className="px-5 py-3">
                <FieldForm
                  initial={f}
                  onCancel={() => setEditing(null)}
                  onSubmit={(v) =>
                    run(
                      () => api<FieldDefinitionDto>(`/fields/${f.id}`, "PATCH", { label: v.label, required: v.required, ...(hasOptions(f.type) ? { options: v.options } : {}) }),
                      (updated) => (replace(updated), setEditing(null)),
                    )
                  }
                  pending={pending}
                />
              </li>
            ) : (
              <li key={f.id} className={clsx("flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5", f.archived && "opacity-60")}>
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{f.label}</span>
                  {f.required && <span className="text-danger"> *</span>}
                  <span className="ml-2 text-xs text-fg-subtle">
                    {k.types[f.type]}
                    {hasOptions(f.type) && ` · ${f.options.join(", ")}`}
                    {f.archived && ` · ${k.archived}`}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  {!f.archived && (
                    <>
                      <button type="button" onClick={() => move(f.id, -1)} disabled={pending || f.id === active[0]?.id} aria-label={`${k.moveUp}: ${f.label}`} className="grid h-7 w-7 place-items-center rounded-md hover:bg-muted disabled:opacity-30">
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button type="button" onClick={() => move(f.id, 1)} disabled={pending || f.id === active.at(-1)?.id} aria-label={`${k.moveDown}: ${f.label}`} className="grid h-7 w-7 place-items-center rounded-md hover:bg-muted disabled:opacity-30">
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button type="button" onClick={() => setEditing(f.id)} className="px-2 text-xs font-medium text-accent hover:underline">
                        {k.edit}
                      </button>
                    </>
                  )}
                  <button type="button" disabled={pending} onClick={() => run(() => api<FieldDefinitionDto>(`/fields/${f.id}`, "PATCH", { archived: !f.archived }), replace)} className="px-2 text-xs font-medium text-fg-muted hover:text-fg">
                    {f.archived ? k.restore : k.archive}
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}

      <div className="border-t border-border p-3">
        {adding ? (
          <FieldForm
            onCancel={() => setAdding(false)}
            onSubmit={(v) => run(() => api<FieldDefinitionDto>("/fields", "POST", { entity, ...v }), (created) => (setFields((all) => [...all, created]), setAdding(false)))}
            pending={pending}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 px-2 text-xs font-medium text-accent hover:underline">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {k.add}
          </button>
        )}
      </div>
    </section>
  );
}

interface FieldValues {
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
}

/** New field (type selectable) or an existing one (type fixed: stored values depend on it). */
function FieldForm({ initial, onSubmit, onCancel, pending }: { initial?: FieldDefinitionDto; onSubmit: (v: FieldValues) => void; onCancel: () => void; pending: boolean }) {
  const { t } = useI18n();
  const k = t.crmSettings;
  const [type, setType] = useState<FieldType>(initial?.type ?? "text");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    onSubmit({ label: String(f.get("label")), type, options: hasOptions(type) ? parseOptions(String(f.get("options") ?? "")) : [], required: f.get("required") === "on" });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="field-label">
        {k.fields.label}
        <input name="label" required maxLength={60} defaultValue={initial?.label} autoFocus className="input" />
      </label>
      <label className="field-label">
        {k.fields.type}
        <select value={type} onChange={(e) => setType(e.target.value as FieldType)} disabled={!!initial} className="input">
          {FIELD_TYPES.map((x) => (
            <option key={x} value={x}>
              {k.fields.types[x]}
            </option>
          ))}
        </select>
      </label>
      {hasOptions(type) && (
        <label className="field-label sm:col-span-2">
          {k.fields.options}
          <textarea name="options" required rows={4} defaultValue={initial?.options.join("\n")} aria-describedby="options-hint" className="input h-auto py-2" />
          <span id="options-hint" className="text-xs font-normal text-fg-subtle">
            {k.fields.optionsHint}
          </span>
        </label>
      )}
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="required" defaultChecked={initial?.required} className="h-4 w-4 accent-[rgb(var(--accent))]" />
        {k.fields.required}
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {k.save}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          {k.cancel}
        </button>
      </div>
    </form>
  );
}
