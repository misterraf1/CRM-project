"use client";

import type { CustomObjectDto, CustomRecordDto, FieldDefinitionDto } from "@/shared";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { CustomFieldInputs, readCustomFields } from "@/components/crm/CustomFieldInputs";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/** The section's fields shaped like custom field definitions, so the shared inputs render them. */
export const fieldDefs = (o: CustomObjectDto): FieldDefinitionDto[] => o.fields.map((f, order) => ({ ...f, entity: "deal", order, archived: false }));

/** Create or edit one record of a custom section, optionally linked to a customer. */
export function RecordForm({ object, record, canDelete }: { object: CustomObjectDto; record?: CustomRecordDto; canDelete?: boolean }) {
  const { t } = useI18n();
  const k = t.objects;
  const router = useRouter();
  const fields = fieldDefs(object);
  const [contact, setContact] = useState(record?.contact ?? null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Customer search: a few names as the member types
  useEffect(() => {
    if (query.trim().length < 2) return setFound([]);
    const timer = setTimeout(async () => {
      const res = await api<{ items: { id: string; name: string }[] }>(`/contacts?q=${encodeURIComponent(query.trim())}&limit=6`);
      if (res.ok) setFound(res.data.items.map((c) => ({ id: c.id, name: c.name })));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const custom = readCustomFields(data, fields);
    if ("invalid" in custom) return setInvalid(custom.invalid);
    setInvalid([]);
    const body = { title: String(data.get("title") ?? "").trim(), values: custom.values, contactId: contact?.id ?? null };
    startTransition(async () => {
      setError(undefined);
      const res = record ? await api<CustomRecordDto>(`/records/${record.id}`, "PATCH", body) : await api<CustomRecordDto>(`/objects/${object.id}/records`, "POST", body);
      if (!res.ok) {
        const bad = Object.keys((res.details as Record<string, unknown> | undefined) ?? {}).filter((x) => x.startsWith("cf."));
        if (bad.length) setInvalid(bad);
        return setError(errorMessage(t, res.code));
      }
      // A full load: the list visited before may still be in the client router cache
      window.location.assign(`/records/${object.id}`);
    });
  };

  const remove = () =>
    record &&
    window.confirm(interpolate(k.confirmDelete, { name: record.title })) &&
    startTransition(async () => {
      const res = await api(`/records/${record.id}`, "DELETE");
      if (!res.ok) return setError(errorMessage(t, res.code));
      window.location.assign(`/records/${object.id}`);
    });

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-4 p-5" aria-busy={pending}>
      <label className="field-label">
        {k.title} <span className="text-danger">*</span>
        <input name="title" required maxLength={200} defaultValue={record?.title} className="input" />
      </label>
      <CustomFieldInputs fields={fields} values={record?.values} invalid={invalid} />
      <div>
        <p className="field-label">{k.customer}</p>
        {contact ? (
          <p className="mt-1 flex items-center gap-2 text-sm">
            <span className="rounded-full bg-accent-soft px-3 py-1 font-medium text-accent">{contact.name}</span>
            <button type="button" onClick={() => setContact(null)} aria-label={k.clear} className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-muted">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </p>
        ) : (
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-fg-subtle" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={k.pickCustomer} aria-label={k.pickCustomer} className="input mt-0 pl-9" />
            {found.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-surface p-1 shadow-lg">
                {found.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => (setContact(c), setQuery(""), setFound([]))} className="w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-muted">
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {k.save}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-ghost">
          {k.cancel}
        </button>
        {record && canDelete && (
          <button type="button" onClick={remove} disabled={pending} className="btn-danger ml-auto border border-danger/30">
            {k.delete}
          </button>
        )}
      </div>
    </form>
  );
}
