"use client";

import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/** Owner/admin: require 2FA from every member of the company. */
export function CompanySecurityCard({ requireMfa: initial, withoutMfa }: { requireMfa: boolean; withoutMfa: number }) {
  const { t } = useI18n();
  const k = t.security;
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setOn(next);
    startTransition(async () => {
      setError(undefined);
      setSaved(false);
      const res = await api("/settings/security", "PATCH", { requireMfa: next });
      if (!res.ok) {
        setOn(!next);
        return setError(res.code === "MFA_SETUP_REQUIRED" ? k.ownFirst : errorMessage(t, res.code, res.details));
      }
      setSaved(true);
    });
  }

  return (
    <section className="card max-w-xl space-y-2 p-5" aria-busy={pending}>
      <h2 className="text-sm font-semibold">{k.company}</h2>
      <label className="flex items-center justify-between gap-3 text-sm">
        {k.requireMfa}
        <input type="checkbox" checked={on} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
      </label>
      <p className="text-xs text-fg-muted">{k.requireMfaHint}</p>
      <p className="text-xs text-fg-subtle">{interpolate(k.membersWithout, { n: withoutMfa })}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {saved && <p role="status" className="text-sm text-success">{k.saved}</p>}
    </section>
  );
}
