"use client";

import { EXPENSE_CATEGORIES, type ExpenseDto } from "@axis/shared";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { adminApi } from "@/lib/api/client";
import { formatDate, formatMoney, parseMoneyInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

export function ExpenseManager({ expenses, today }: { expenses: ExpenseDto[]; today: string }) {
  const { t, locale } = useI18n();
  const k = t.admin.expenses;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const run = (fn: () => ReturnType<typeof adminApi>, onOk?: () => void) =>
    startTransition(async () => {
      setError(undefined);
      const res = await fn();
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      onOk?.();
      router.refresh();
    });

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const amount = parseMoneyInput(String(f.get("amount")));
    if (!amount) return setError(t.errors.VALIDATION_FAILED);
    const note = String(f.get("note")).trim();
    run(
      () => adminApi("/expenses", "POST", { category: f.get("category"), vendor: String(f.get("vendor")), amount, incurredOn: f.get("incurredOn"), ...(note ? { note } : {}) }),
      () => form.reset(),
    );
  }

  const total = expenses.reduce((a, e) => a + e.amount, 0);
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[140px_1fr_120px_150px_1fr_auto] lg:items-end">
        <label className="field-label">
          {k.category}
          <select name="category" className="input">
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {k.categories[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          {k.vendor}
          <input name="vendor" required minLength={2} maxLength={80} className="input" />
        </label>
        <label className="field-label">
          {k.amount}
          <input name="amount" required inputMode="decimal" className="input" />
        </label>
        <label className="field-label">
          {k.date}
          <input name="incurredOn" type="date" required defaultValue={today} className="input" />
        </label>
        <label className="field-label">
          {k.note}
          <input name="note" maxLength={500} className="input" />
        </label>
        <button type="submit" disabled={pending} className="btn-primary">
          {k.add}
        </button>
      </form>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="card relative overflow-x-auto">
        {expenses.length === 0 ? (
          <p className="p-6 text-sm text-fg-muted">{k.empty}</p>
        ) : (
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-subtle">
                <th scope="col" className="px-4 py-2 font-medium">{k.date}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.category}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.vendor}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.note}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{k.amount}</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">{k.delete}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-fg-muted">{formatDate(e.incurredOn, locale)} {e.incurredOn.slice(0, 4)}</td>
                  <td className="px-3 text-xs">{k.categories[e.category]}</td>
                  <td className="px-3">{e.vendor}</td>
                  <td className="px-3 text-xs text-fg-muted">{e.note}</td>
                  <td className="tabular px-3 text-right font-medium">{formatMoney(e.amount, locale, e.currency)}</td>
                  <td className="px-4 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => window.confirm(interpolate(k.confirmDelete, { vendor: e.vendor })) && run(() => adminApi(`/expenses/${e.id}`, "DELETE"))}
                      className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"
                      aria-label={`${k.delete}: ${e.vendor}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border">
                <td colSpan={4} className="px-4 py-2 text-right text-xs font-medium text-fg-muted">{k.total}</td>
                <td className="tabular px-3 py-2 text-right font-semibold">{formatMoney(total, locale)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
