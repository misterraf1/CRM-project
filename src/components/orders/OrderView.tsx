"use client";

import type { MemberDto, OrderDto } from "@/shared";
import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { api, type ClientResult } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { useHydrated } from "@/lib/use-hydrated";

const dateInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

/** Steps of an order: tick off, reassign, reschedule; plus the order's own dates, cancel and delete. */
export function OrderView({ order: initial, members }: { order: OrderDto; members: MemberDto[] }) {
  const { t, locale } = useI18n();
  const k = t.orders;
  const router = useRouter();
  const hydrated = useHydrated();
  // The API's answer applies at once; server data wins on refresh
  const [order, setOrder] = useState(initial);
  useEffect(() => setOrder(initial), [initial]);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = members.filter((m) => m.status === "ACTIVE");
  const canceled = order.status === "canceled";

  function run(call: () => Promise<ClientResult<OrderDto>>, after?: () => void, before?: OrderDto) {
    startTransition(async () => {
      setError(undefined);
      setSaved(false);
      const res = await call();
      if (!res.ok) {
        if (before) setOrder(before);
        return setError(errorMessage(t, res.code, res.details));
      }
      setOrder(res.data);
      after?.();
      router.refresh();
    });
  }

  function step(id: string, patch: { done?: boolean; assigneeId?: string | null; dueDate?: string | null }) {
    const before = order;
    // Ticking a step shows at once; a failed save puts it back
    if (patch.done !== undefined) {
      setOrder({ ...order, steps: order.steps.map((s) => (s.id === id ? { ...s, doneAt: patch.done ? new Date().toISOString() : null } : s)) });
    }
    run(() => api<OrderDto>(`/orders/${order.id}/steps/${id}`, "PATCH", patch), undefined, before);
  }

  function addStep(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    run(() => api<OrderDto>(`/orders/${order.id}/steps`, "POST", { title: String(f.get("title")), assigneeId: String(f.get("assigneeId") || "") || null, dueDate: String(f.get("dueDate") || "") || null }), () => form.reset());
  }

  function saveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(
      () =>
        api<OrderDto>(`/orders/${order.id}`, "PATCH", {
          title: String(f.get("title")),
          dueDate: String(f.get("dueDate") || "") || null,
          deliveryDate: String(f.get("deliveryDate") || "") || null,
          notes: String(f.get("notes") ?? ""),
          warrantyMonths: f.get("warrantyMonths") ? Number(f.get("warrantyMonths")) : null,
        }),
      () => setSaved(true),
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" aria-busy={pending}>
      <section className="card p-5" aria-labelledby="steps-title">
        <h2 id="steps-title" className="text-sm font-semibold">
          {k.steps}
        </h2>
        <p className="mt-1 text-xs text-fg-muted">{k.customerSees}</p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <ol className="mt-3 divide-y divide-border">
          {order.steps.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <label className="flex min-w-[12rem] flex-1 items-center gap-2 text-sm">
                <input type="checkbox" checked={!!s.doneAt} disabled={canceled || !hydrated} onChange={(e) => step(s.id, { done: e.target.checked })} />
                <span className={clsx(s.doneAt && "text-fg-muted line-through")}>
                  {i + 1}. {s.title}
                </span>
                {s.overdue && <span className="rounded-full bg-danger/10 px-1.5 text-[10px] font-medium text-danger">{k.late}</span>}
              </label>
              {s.doneAt ? (
                <span className="text-xs text-fg-muted">{interpolate(k.doneBy, { name: s.doneBy ?? "", date: formatDate(s.doneAt, locale, "short") })}</span>
              ) : (
                <>
                  <select
                    aria-label={`${k.assignee}: ${s.title}`}
                    value={s.assignee?.id ?? ""}
                    disabled={pending || canceled}
                    onChange={(e) => step(s.id, { assigneeId: e.target.value || null })}
                    className="input mt-0 h-8 w-40 text-xs"
                  >
                    <option value="">{k.nobody}</option>
                    {active.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    aria-label={`${k.stepDue}: ${s.title}`}
                    defaultValue={dateInput(s.dueDate)}
                    disabled={pending || canceled}
                    onChange={(e) => step(s.id, { dueDate: e.target.value || null })}
                    className="input mt-0 h-8 w-36 text-xs"
                  />
                </>
              )}
              {!canceled && (
                <button type="button" disabled={pending} onClick={() => run(() => api<OrderDto>(`/orders/${order.id}/steps/${s.id}`, "DELETE"))} aria-label={`${k.removeStep}: ${s.title}`} className="rounded-md p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ol>
        {!canceled && (
          <form onSubmit={addStep} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="field-label min-w-[10rem] flex-1">
              {k.stepTitle}
              <input name="title" required maxLength={120} className="input" />
            </label>
            <label className="field-label w-40">
              {k.assignee}
              <select name="assigneeId" defaultValue="" className="input">
                <option value="">{k.nobody}</option>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label w-36">
              {k.stepDue}
              <input name="dueDate" type="date" className="input" />
            </label>
            <button type="submit" disabled={pending || !hydrated} className="btn-ghost border border-border">
              <Plus className="h-4 w-4" aria-hidden />
              {k.addStep}
            </button>
          </form>
        )}
      </section>

      <section className="card h-fit p-5">
        <form onSubmit={saveDetails} className="space-y-3">
          <label className="field-label">
            {k.name}
            <input name="title" required maxLength={200} defaultValue={order.title} className="input" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="field-label">
              {k.dueDate}
              <input name="dueDate" type="date" defaultValue={dateInput(order.dueDate)} className="input" />
            </label>
            <label className="field-label">
              {k.deliveryDate}
              <input name="deliveryDate" type="date" defaultValue={dateInput(order.deliveryDate)} className="input" />
            </label>
          </div>
          <label className="field-label">
            {t.cases.warrantyMonths}
            <input name="warrantyMonths" type="number" min={1} max={240} defaultValue={order.warrantyMonths ?? ""} className="input" />
            {order.warrantyUntil && <span className="mt-1 block text-[11px] font-normal text-fg-subtle">{interpolate(t.cases.warrantyUntil, { date: formatDate(order.warrantyUntil, locale, "long") })}</span>}
          </label>
          <label className="field-label">
            {k.notes}
            <textarea name="notes" rows={3} maxLength={2000} defaultValue={order.notes ?? ""} className="input min-h-[72px] py-2" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending || !hydrated} className="btn-primary">
              {k.save}
            </button>
            {saved && <span role="status" className="text-sm text-success">{k.saved}</span>}
          </div>
        </form>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {canceled ? (
            <button type="button" disabled={pending} onClick={() => run(() => api<OrderDto>(`/orders/${order.id}`, "PATCH", { canceled: false }))} className="btn-ghost h-8 border border-border text-xs">
              {k.reopen}
            </button>
          ) : (
            <button type="button" disabled={pending} onClick={() => window.confirm(k.confirmCancel) && run(() => api<OrderDto>(`/orders/${order.id}`, "PATCH", { canceled: true }))} className="btn-ghost h-8 border border-border text-xs">
              {k.cancel}
            </button>
          )}
          {!order.steps.some((s) => s.doneAt) && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                window.confirm(k.confirmDelete) &&
                startTransition(async () => {
                  const res = await api(`/orders/${order.id}`, "DELETE");
                  if (!res.ok) return setError(errorMessage(t, res.code, res.details));
                  router.push("/orders");
                })
              }
              className="btn-danger h-8 text-xs"
            >
              {k.delete}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
