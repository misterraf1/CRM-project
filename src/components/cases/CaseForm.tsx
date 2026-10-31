"use client";

import { CASE_TYPES, PRIORITIES, type CaseDto, type MemberDto, type OrderSummaryDto } from "@/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { ContactCombobox } from "@/components/calendar/ContactCombobox";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { useHydrated } from "@/lib/use-hydrated";

/** Opening a case: customer, optional order (for the warranty), type, priority, who handles it. */
export function CaseForm({ members, meId, canAssign, contact: initial }: { members: MemberDto[]; meId: string; canAssign: boolean; contact: { id: string; name: string } | null }) {
  const { t } = useI18n();
  const k = t.cases;
  const f = k.fields;
  const router = useRouter();
  const hydrated = useHydrated();
  const [contact, setContact] = useState(initial);
  const [orders, setOrders] = useState<OrderSummaryDto[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setOrders([]);
    if (!contact) return;
    void api<OrderSummaryDto[]>(`/orders?contactId=${encodeURIComponent(contact.id)}`).then((r) => r.ok && setOrders(r.data));
  }, [contact]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!contact) return setError(errorMessage(t, "VALIDATION_FAILED"));
    const form = new FormData(e.currentTarget);
    const get = (n: string) => String(form.get(n) ?? "");
    startTransition(async () => {
      setError(undefined);
      const res = await api<CaseDto>("/cases", "POST", {
        contactId: contact.id,
        orderId: get("orderId") || null,
        type: get("type"),
        priority: get("priority"),
        subject: get("subject"),
        description: get("description") || null,
        assigneeId: canAssign ? get("assigneeId") || null : meId,
      });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      router.push(`/cases/${res.data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5" aria-busy={pending}>
      <ContactCombobox label={f.contact} placeholder={f.contact} value={contact} onChange={setContact} />
      <label className="field-label">
        {f.subject}
        <input name="subject" required minLength={2} maxLength={200} className="input mt-1" />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="field-label">
          {f.type}
          <select name="type" defaultValue="complaint" className="input mt-1">
            {CASE_TYPES.map((x) => (
              <option key={x} value={x}>
                {k.types[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          {f.priority}
          <select name="priority" defaultValue="MEDIUM" className="input mt-1">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t.dashboard.tasks.priority[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          {f.order}
          <select name="orderId" defaultValue="" disabled={!orders.length} className="input mt-1">
            <option value="">{k.fields.noOrder}</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.number} · {o.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {canAssign && (
        <label className="field-label">
          {f.assignee}
          <select name="assigneeId" defaultValue={meId} className="input mt-1">
            <option value="">{t.crm.unassigned}</option>
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
      <label className="field-label">
        {f.description}
        <textarea name="description" rows={5} maxLength={5000} className="input mt-1" />
      </label>
      <p className="text-xs text-fg-subtle">{k.slaHint}</p>
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || !hydrated} className="btn-primary">
        {k.create}
      </button>
    </form>
  );
}
