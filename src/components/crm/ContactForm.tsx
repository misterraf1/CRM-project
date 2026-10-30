"use client";

import { CONTACT_SOURCES, LIFECYCLE_STAGES, type ContactDto, type ContactListResponse, type DuplicateMatchesDto, type FieldDefinitionDto, type MemberDto } from "@/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { CustomFieldInputs, readCustomFields } from "./CustomFieldInputs";

interface Props {
  /** Editing an existing contact; omitted when creating */
  contact?: ContactDto;
  members: MemberDto[];
  canAssign: boolean;
  selfMemberId: string;
  /** Custom fields for people ("contact") and companies ("company") */
  fields: { contact: FieldDefinitionDto[]; company: FieldDefinitionDto[] };
  /** New person pre-linked to a company (the company page's "add person") */
  defaultCompany?: { id: string; name: string };
  /** Shown without editing (the member's role can't change it) */
  readOnly?: boolean;
}

/** Create and edit share one form so validation and fields never drift apart. */
export function ContactForm({ contact, members, canAssign, selfMemberId, fields, defaultCompany, readOnly = false }: Props) {
  const { t } = useI18n();
  const c = t.crm;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message?: string; fields: string[] }>({ fields: [] });
  const [saved, setSaved] = useState(false);
  const [type, setType] = useState(contact?.type ?? "person");
  const [company, setCompany] = useState<{ id: string | null; name: string }>(
    contact ? { id: contact.companyId, name: contact.companyName ?? "" } : { id: defaultCompany?.id ?? null, name: defaultCompany?.name ?? "" },
  );
  const activeFields = type === "company" ? fields.company : fields.contact;
  const [dupes, setDupes] = useState<DuplicateMatchesDto | null>(null);

  /** Warns (doesn't block) when the email or phone is already on a contact. */
  async function checkDuplicates(form: HTMLFormElement | null) {
    if (!form) return;
    const f = new FormData(form);
    const qs = new URLSearchParams({ email: String(f.get("email") ?? "").trim(), phone: String(f.get("phone") ?? "").trim(), ...(contact ? { excludeId: contact.id } : {}) });
    const res = await api<DuplicateMatchesDto>(`/contacts/duplicates?${qs}`);
    setDupes(res.ok && (res.data.items.length || res.data.hidden) ? res.data : null);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const custom = readCustomFields(f, activeFields);
    if ("invalid" in custom) return setError({ message: t.errors.VALIDATION_FAILED, fields: custom.invalid });
    const body: Record<string, unknown> = {
      type,
      name: String(f.get("name")),
      email: String(f.get("email")),
      phone: String(f.get("phone")),
      stage: String(f.get("stage")),
      source: String(f.get("source")),
      tags: [
        ...new Set(
          String(f.get("tags") ?? "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ],
      customFields: custom.values,
    };
    if (type === "person") Object.assign(body, company.id ? { companyId: company.id } : { companyId: null, companyName: company.name });
    if (canAssign) body.ownerId = String(f.get("ownerId")) || null;

    setError({ fields: [] });
    setSaved(false);
    startTransition(async () => {
      const res = contact
        ? await api<ContactDto>(`/contacts/${contact.id}`, "PATCH", body)
        : await api<ContactDto>("/contacts", "POST", body);
      if (!res.ok) {
        const bad = res.details && typeof res.details === "object" ? Object.keys(res.details) : [];
        setError({ message: errorMessage(t, res.code), fields: bad });
        return;
      }
      if (contact) {
        setSaved(true);
        router.refresh();
      } else {
        router.push(`/crm/${res.data.id}`);
      }
    });
  }

  const invalid = (name: string) => (error.fields.includes(name) ? { "aria-invalid": true, className: "input border-danger" } : { className: "input" });

  return (
    <form onSubmit={submit} aria-busy={pending}>
      <fieldset disabled={readOnly} className="min-w-0 space-y-4">
      {error.message && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error.message}
        </p>
      )}
      <div role="radiogroup" aria-label={c.type} className="flex rounded-lg bg-muted p-0.5 text-xs font-medium sm:w-fit">
        {(["person", "company"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={type === v}
            onClick={() => setType(v)}
            className={`flex-1 rounded-md px-3 py-1.5 ${type === v ? "bg-surface text-fg shadow-sm" : "text-fg-muted"}`}
          >
            {v === "person" ? c.person : c.company}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field-label sm:col-span-2">
          {c.name}
          <input name="name" required maxLength={150} defaultValue={contact?.name} autoFocus={!contact} {...invalid("name")} />
        </label>
        <label className="field-label">
          {c.phone}
          <input name="phone" type="tel" inputMode="tel" placeholder="+994 50 123 45 67" defaultValue={contact?.phone ?? ""} onBlur={(e) => void checkDuplicates(e.currentTarget.form)} {...invalid("phone")} />
        </label>
        <label className="field-label">
          {c.email}
          <input name="email" type="email" defaultValue={contact?.email ?? ""} onBlur={(e) => void checkDuplicates(e.currentTarget.form)} {...invalid("email")} />
        </label>
        {dupes && (
          <div role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm sm:col-span-2">
            {dupes.items.length > 0 && (
              <>
                <p className="font-medium">{c.duplicateFound}</p>
                <ul className="mt-1 space-y-0.5">
                  {dupes.items.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-x-2">
                      <Link href={`/crm/${d.id}`} className="font-medium text-accent hover:underline">
                        {d.name}
                      </Link>
                      <span className="text-xs text-fg-muted">{d.match === "email" ? d.email : d.phone}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {dupes.hidden > 0 && <p className="text-xs text-fg-muted">{interpolate(c.duplicateHidden, { n: dupes.hidden })}</p>}
          </div>
        )}
        {type === "person" && <CompanyPicker value={company} onChange={setCompany} invalid={error.fields.includes("companyId")} selfId={contact?.id} />}
        <label className="field-label">
          {c.colStage}
          <select name="stage" defaultValue={contact?.stage ?? "LEAD"} className="input">
            {LIFECYCLE_STAGES.map((s) => (
              <option key={s} value={s}>
                {c.stages[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          {c.source}
          <select name="source" defaultValue={contact?.source ?? "manual"} className="input">
            {CONTACT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {c.sources[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label sm:col-span-2">
          {c.tags}
          <input name="tags" maxLength={500} defaultValue={contact?.tags.join(", ") ?? ""} placeholder={c.tagsHint} className="input" />
        </label>
        <CustomFieldInputs key={type} fields={activeFields} values={contact?.type === type ? contact.customFields : {}} invalid={error.fields} />
        {canAssign && (
          <label className="field-label sm:col-span-2">
            {c.owner}
            <select name="ownerId" defaultValue={contact ? (contact.owner?.id ?? "") : selfMemberId} className="input">
              <option value="">{c.unassigned}</option>
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
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={readOnly ? "hidden" : "btn-primary"}>
          {contact ? c.save : c.create}
        </button>
        {!contact && (
          <button type="button" onClick={() => router.back()} className="btn-ghost">
            {c.cancel}
          </button>
        )}
        {saved && (
          <span role="status" className="text-sm text-success">
            {c.saved}
          </span>
        )}
      </div>
      </fieldset>
    </form>
  );
}

/**
 * Company of a person: suggestions come from the company contacts as you type. Picking
 * one links the card; a name typed by hand is kept as plain text without a link.
 */
function CompanyPicker({
  value,
  onChange,
  invalid,
  selfId,
}: {
  value: { id: string | null; name: string };
  onChange: (v: { id: string | null; name: string }) => void;
  invalid: boolean;
  selfId?: string;
}) {
  const { t } = useI18n();
  const c = t.crm;
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    const q = value.name.trim();
    timer.current = setTimeout(async () => {
      const res = await api<ContactListResponse>(`/contacts?type=company&limit=8${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      if (res.ok) setOptions(res.data.items.filter((x) => x.id !== selfId).map((x) => ({ id: x.id, name: x.name })));
    }, 200);
    return () => clearTimeout(timer.current);
  }, [value.name, selfId]);

  return (
    <div className="sm:col-span-2">
      <label className="field-label">
        {c.company}
        <input
          name="companyName"
          list="company-options"
          maxLength={150}
          value={value.name}
          autoComplete="off"
          onChange={(e) => {
            const name = e.target.value;
            const match = options.find((o) => o.name === name);
            onChange({ id: match?.id ?? null, name });
          }}
          aria-describedby="company-hint"
          {...(invalid ? { "aria-invalid": true, className: "input border-danger" } : { className: "input" })}
        />
      </label>
      <datalist id="company-options">
        {options.map((o) => (
          <option key={o.id} value={o.name} />
        ))}
      </datalist>
      <p id="company-hint" className="mt-1 text-xs text-fg-subtle">
        {value.id ? (
          // No prefetch: the router would show that snapshot even after this person is linked
          <Link href={`/crm/${value.id}`} prefetch={false} className="text-accent hover:underline">
            {c.linkedCompany} →
          </Link>
        ) : (
          c.companyHint
        )}
      </p>
    </div>
  );
}
