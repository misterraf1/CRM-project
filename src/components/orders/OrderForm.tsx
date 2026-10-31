"use client";

import type { MemberDto, OrderDto } from "@/shared";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { useHydrated } from "@/lib/use-hydrated";

interface StepRow {
  key: string;
  title: string;
  assigneeId: string;
  dueDate: string;
}

let seq = 0;
const row = (title = ""): StepRow => ({ key: `s${seq++}`, title, assigneeId: "", dueDate: "" });

/** New order: customer, dates and the execution steps (prefilled from the company's default steps). */
export function OrderForm({
  contacts,
  members,
  defaults,
}: {
  contacts: { id: string; name: string }[];
  members: MemberDto[];
  defaults: { title: string; contactId?: string; dealId?: string | null; quote?: { id: string; number: string | null } | null; steps: string[] };
}) {
  const { t } = useI18n();
  const k = t.orders;
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [steps, setSteps] = useState<StepRow[]>(() => (defaults.steps.length ? defaults.steps.map((s) => row(s)) : [row()]));
  const active = members.filter((m) => m.status === "ACTIVE");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      title: String(f.get("title")),
      contactId: String(f.get("contactId")),
      dealId: defaults.dealId ?? null,
      quoteId: defaults.quote?.id ?? null,
      dueDate: String(f.get("dueDate") || "") || null,
      deliveryDate: String(f.get("deliveryDate") || "") || null,
      notes: String(f.get("notes") ?? ""),
      warrantyMonths: f.get("warrantyMonths") ? Number(f.get("warrantyMonths")) : null,
      steps: steps.filter((s) => s.title.trim()).map((s) => ({ title: s.title.trim(), assigneeId: s.assigneeId || null, dueDate: s.dueDate || null })),
    };
    startTransition(async () => {
      setError(undefined);
      const res = await api<OrderDto>("/orders", "POST", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      router.push(`/orders/${res.data.id}`);
    });
  }

  const update = (key: string, patch: Partial<StepRow>) => setSteps((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  return (
    <form onSubmit={submit} className="space-y-5" aria-busy={pending}>
      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <label className="field-label sm:col-span-2">
          {k.name}
          <input name="title" required maxLength={200} defaultValue={defaults.title} className="input" />
        </label>
        <label className="field-label">
          {k.customer}
          <select name="contactId" required defaultValue={defaults.contactId ?? ""} className="input">
            <option value="" disabled>
              {k.chooseCustomer}
            </option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {defaults.quote && (
          <p className="self-end text-sm text-fg-muted">
            {k.quote}: <span className="font-mono">{defaults.quote.number}</span>
          </p>
        )}
        <label className="field-label">
          {k.dueDate}
          <input name="dueDate" type="date" className="input" />
        </label>
        <label className="field-label">
          {k.deliveryDate}
          <input name="deliveryDate" type="date" className="input" />
        </label>
        <label className="field-label">
          {t.cases.warrantyMonths}
          <input name="warrantyMonths" type="number" min={1} max={240} className="input" />
        </label>
        <label className="field-label sm:col-span-2">
          {k.notes}
          <textarea name="notes" rows={2} maxLength={2000} className="input min-h-[60px] py-2" />
        </label>
      </section>

      <section className="card p-5" aria-labelledby="order-steps">
        <h2 id="order-steps" className="text-sm font-semibold">
          {k.steps}
        </h2>
        <p className="mt-1 text-xs text-fg-muted">{k.stepsHint}</p>
        <ol className="mt-3 space-y-2">
          {steps.map((s, i) => (
            <li key={s.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_12rem_10rem_auto]">
              <label className="col-span-2 text-xs font-medium sm:col-span-1">
                {k.stepTitle} {i + 1}
                <input value={s.title} onChange={(e) => update(s.key, { title: e.target.value })} maxLength={120} className="input mt-0 h-9" />
              </label>
              <label className="text-xs font-medium">
                {k.assignee}
                <select value={s.assigneeId} onChange={(e) => update(s.key, { assigneeId: e.target.value })} className="input mt-0 h-9">
                  <option value="">{k.nobody}</option>
                  {active.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium">
                {k.stepDue}
                <input type="date" value={s.dueDate} onChange={(e) => update(s.key, { dueDate: e.target.value })} className="input mt-0 h-9" />
              </label>
              <button
                type="button"
                onClick={() => setSteps((all) => all.filter((x) => x.key !== s.key))}
                aria-label={`${k.removeStep} ${i + 1}`}
                className="self-end rounded-md p-2 text-fg-subtle hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setSteps((all) => [...all, row()])} className="btn-ghost mt-3 h-8 border border-dashed border-border text-xs">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {k.addStep}
        </button>
      </section>

      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={pending || !hydrated} className="btn-primary">
        {k.create}
      </button>
    </form>
  );
}
