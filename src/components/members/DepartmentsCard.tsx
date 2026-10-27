"use client";

import type { DepartmentDto } from "@/shared";
import { Lock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/** `locked`: the plan has no department management — existing ones can still be removed. */
export function DepartmentsCard({ departments, canManage, locked }: { departments: DepartmentDto[]; canManage: boolean; locked: boolean }) {
  const { t } = useI18n();
  const m = t.members;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function run(action: () => Promise<{ ok: boolean; code?: string; details?: unknown }>, onOk?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const res = await action();
      if (res.ok) onOk?.();
      else setError(errorMessage(t, res.code, res.details));
      router.refresh();
    });
  }

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name")).trim();
    run(() => api("/departments", "POST", { name }), () => form.reset());
  }

  return (
    <section className="card" aria-busy={pending}>
      <h2 className="px-4 pt-4 text-sm font-semibold">{m.departments}</h2>
      {departments.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fg-muted">{m.noDepartments}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {departments.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{d.name}</p>
                <p className="text-xs text-fg-subtle">{interpolate(m.membersCount, { n: d.memberCount })}</p>
              </div>
              {canManage && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => window.confirm(interpolate(m.confirmDeleteDepartment, { name: d.name })) && run(() => api(`/departments/${d.id}`, "DELETE"))}
                  className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"
                  title={m.deleteDepartment}
                  aria-label={`${m.deleteDepartment}: ${d.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mx-4 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {canManage && locked && (
        <Link href="/settings/billing" className="flex items-center gap-2 border-t border-border p-3 text-xs text-fg-muted hover:text-fg">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          {t.billing.lockedHint}
        </Link>
      )}
      {canManage && !locked && (
        <form onSubmit={add} className="flex gap-2 border-t border-border p-3">
          <input name="name" required minLength={2} maxLength={80} placeholder={m.departmentName} aria-label={m.departmentName} className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-sm" />
          <button type="submit" disabled={pending} className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg disabled:opacity-60">
            {m.addDepartment}
          </button>
        </form>
      )}
    </section>
  );
}
