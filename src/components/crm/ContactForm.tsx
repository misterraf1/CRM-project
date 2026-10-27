"use client";

import { CONTACT_SOURCES, LIFECYCLE_STAGES, type ContactDto, type MemberDto } from "@axis/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

interface Props {
  /** Editing an existing contact; omitted when creating */
  contact?: ContactDto;
  members: MemberDto[];
  canAssign: boolean;
  selfMemberId: string;
}

/** Create and edit share one form so validation and fields never drift apart. */
export function ContactForm({ contact, members, canAssign, selfMemberId }: Props) {
  const { t } = useI18n();
  const c = t.crm;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message?: string; fields: string[] }>({ fields: [] });
  const [saved, setSaved] = useState(false);
  const [type, setType] = useState(contact?.type ?? "person");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      type,
      name: String(f.get("name")),
      email: String(f.get("email")),
      phone: String(f.get("phone")),
      companyName: String(f.get("companyName") ?? ""),
      stage: String(f.get("stage")),
      source: String(f.get("source")),
    };
    if (canAssign) body.ownerId = String(f.get("ownerId")) || null;

    setError({ fields: [] });
    setSaved(false);
    startTransition(async () => {
      const res = contact
        ? await api<ContactDto>(`/contacts/${contact.id}`, "PATCH", body)
        : await api<ContactDto>("/contacts", "POST", body);
      if (!res.ok) {
        const fields = res.details && typeof res.details === "object" ? Object.keys(res.details) : [];
        setError({ message: errorMessage(t, res.code), fields });
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
    <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
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
          <input name="phone" type="tel" inputMode="tel" placeholder="+994 50 123 45 67" defaultValue={contact?.phone ?? ""} {...invalid("phone")} />
        </label>
        <label className="field-label">
          {c.email}
          <input name="email" type="email" defaultValue={contact?.email ?? ""} {...invalid("email")} />
        </label>
        {type === "person" && (
          <label className="field-label sm:col-span-2">
            {c.companyName}
            <input name="companyName" maxLength={150} defaultValue={contact?.companyName ?? ""} className="input" />
          </label>
        )}
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
        <button type="submit" disabled={pending} className="btn-primary">
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
    </form>
  );
}
