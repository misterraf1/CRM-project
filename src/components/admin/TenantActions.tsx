"use client";

import type { SubscriptionStatus } from "@/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { adminApi } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/** Support gestures on one company (SUPER_ADMIN; the API enforces it too). */
export function TenantActions({ tenantId, name, status, canAct }: { tenantId: string; name: string; status: SubscriptionStatus; canAct: boolean }) {
  const { t } = useI18n();
  const k = t.admin.tenants;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const run = (fn: () => ReturnType<typeof adminApi>, onOk?: () => void) =>
    startTransition(async () => {
      setError(undefined);
      setNotice(undefined);
      const res = await fn();
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setNotice(k.done);
      onOk?.();
      router.refresh();
    });

  if (!canAct) return <p className="text-xs text-fg-subtle">{t.admin.readOnly}</p>;

  function extend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const days = Number(new FormData(e.currentTarget).get("days"));
    run(() => adminApi(`/tenants/${tenantId}/extend-trial`, "POST", { days }));
  }

  function suspend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const reason = String(new FormData(form).get("reason"));
    if (!window.confirm(interpolate(k.confirmSuspend, { name }))) return;
    run(() => adminApi(`/tenants/${tenantId}/suspend`, "POST", { reason }), () => form.reset());
  }

  const inactive = status === "SUSPENDED" || status === "CANCELED";
  return (
    <div className="space-y-4" aria-busy={pending}>
      {notice && <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {(status === "TRIALING" || status === "SUSPENDED") && (
        <form onSubmit={extend} className="flex items-end gap-2">
          <label className="field-label w-24">
            {k.days}
            <input name="days" type="number" min={1} max={60} defaultValue={7} required className="input" />
          </label>
          <button type="submit" disabled={pending} className="btn-primary">
            {k.extendTrial}
          </button>
        </form>
      )}
      {!inactive && (
        <form onSubmit={suspend} className="space-y-2">
          <label className="field-label">
            {k.suspendReason}
            <input name="reason" required minLength={3} maxLength={500} className="input" />
          </label>
          <button type="submit" disabled={pending} className="btn-danger border border-danger/30">
            {k.suspend}
          </button>
        </form>
      )}
      {status === "SUSPENDED" && (
        <div>
          <button type="button" disabled={pending} onClick={() => run(() => adminApi(`/tenants/${tenantId}/unsuspend`, "POST"))} className="btn-ghost border border-border">
            {k.unsuspend}
          </button>
          <p className="mt-1 text-[11px] text-fg-subtle">{k.unsuspendHint}</p>
        </div>
      )}
      <p className="text-[11px] text-fg-subtle">{k.auditNote}</p>
    </div>
  );
}
