"use client";

import { KeyRound } from "lucide-react";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { CopyField } from "./CopyField";

/** Contact card: make (or email) the customer's portal link; a new one replaces the old. */
export function PortalLinkCard({ contactId, hasEmail }: { contactId: string; hasEmail: boolean }) {
  const { t } = useI18n();
  const k = t.portal;
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const create = (email: boolean) =>
    startTransition(async () => {
      setError(undefined);
      setNote(undefined);
      const res = await api<{ path: string; emailed: boolean }>(`/contacts/${contactId}/portal`, "POST", { email });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setLink(`${window.location.origin}${res.data.path}`);
      if (res.data.emailed) setNote(k.emailed);
    });

  return (
    <section className="card space-y-3 p-5" aria-labelledby="portal-card" aria-busy={pending}>
      <h2 id="portal-card" className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="h-4 w-4 text-accent" aria-hidden />
        {k.title}
      </h2>
      <p className="text-xs text-fg-muted">{k.hint}</p>
      {link && <CopyField label={k.link} value={link} copy={k.copy} copied={k.copied} />}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => create(false)} className="btn-ghost h-8 border border-border text-xs">
          {k.create}
        </button>
        {hasEmail && (
          <button type="button" disabled={pending} onClick={() => create(true)} className="btn-ghost h-8 border border-border text-xs">
            {k.send}
          </button>
        )}
        {link && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await api(`/contacts/${contactId}/portal`, "DELETE");
                if (!res.ok) return setError(errorMessage(t, res.code, res.details));
                setLink(null);
              })
            }
            className="btn-ghost h-8 text-xs text-danger"
          >
            {k.revoke}
          </button>
        )}
      </div>
      {note && <p role="status" className="text-xs text-success">{note}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </section>
  );
}
