"use client";

import type { ContactDto } from "@/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/** The customer's permission for messages we start (WhatsApp templates, campaigns). */
export function ConsentControl({ contactId, consent, canEdit }: { contactId: string; consent: ContactDto["messagingConsent"]; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const k = t.crm.consent;
  const router = useRouter();
  const [value, setValue] = useState(consent?.status ?? "");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const before = value;
    setValue(next);
    startTransition(async () => {
      setError(undefined);
      const res = await api(`/contacts/${contactId}/consent`, "PATCH", { status: next || null });
      if (!res.ok) {
        setValue(before);
        return setError(errorMessage(t, res.code, res.details));
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <label className="field-label">
        {k.label}
        <select value={value} disabled={!canEdit || pending} onChange={(e) => change(e.target.value)} className="input">
          <option value="">{k.unknown}</option>
          <option value="opted_in">{k.optedIn}</option>
          <option value="opted_out">{k.optedOut}</option>
        </select>
      </label>
      <p className="mt-1 text-[11px] text-fg-subtle">
        {consent ? interpolate(consent.source === "keyword" ? k.byKeyword : k.byStaff, { date: formatDate(consent.at, locale, "long") }) : k.hint}
      </p>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
