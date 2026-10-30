"use client";

import { MUTABLE_NOTIFICATIONS } from "@/shared";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

/** One switch per notification type; saved on change. Billing notices can't be turned off. */
export function NotificationPrefs({ muted: initial }: { muted: string[] }) {
  const { t } = useI18n();
  const k = t.notificationPrefs;
  const [muted, setMuted] = useState(new Set(initial));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(type: string, on: boolean) {
    const before = muted;
    const next = new Set(muted);
    if (on) next.delete(type);
    else next.add(type);
    setMuted(next);
    startTransition(async () => {
      setError(undefined);
      setSaved(false);
      const res = await api("/members/me/notifications", "PATCH", { muted: [...next] });
      if (!res.ok) {
        setMuted(before);
        return setError(errorMessage(t, res.code, res.details));
      }
      setSaved(true);
    });
  }

  return (
    <section className="card max-w-2xl p-5" aria-busy={pending}>
      <fieldset>
        <legend className="text-sm font-semibold">{k.receive}</legend>
        <ul className="mt-3 divide-y divide-border">
          {MUTABLE_NOTIFICATIONS.map((type) => (
            <li key={type} className="py-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                {k.types[type]}
                <input type="checkbox" checked={!muted.has(type)} onChange={(e) => toggle(type, e.target.checked)} />
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <p className="mt-3 text-xs text-fg-subtle">{k.billingNote}</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {saved && <p role="status" className="mt-2 text-sm text-success">{k.saved}</p>}
    </section>
  );
}
