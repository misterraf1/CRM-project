"use client";

import { Paperclip } from "lucide-react";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { useHydrated } from "@/lib/use-hydrated";

/** The customer's actions in their portal: a new request, a document for us. */
export function PortalActions({ token }: { token: string }) {
  const { t } = useI18n();
  const k = t.portal;
  const hydrated = useHydrated();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const base = `/api/v1/public/portal/${encodeURIComponent(token)}`;

  const send = (fn: () => Promise<Response>, onOk?: () => void) =>
    startTransition(async () => {
      setError(undefined);
      const res = await fn();
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string; details?: unknown } } | null;
        return setError(errorMessage(t, body?.error?.code ?? "INTERNAL", body?.error?.details));
      }
      onOk?.();
      // A full reload: the portal page is rendered on the server
      window.location.reload();
    });

  function openCase(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    send(
      () => fetch(`${base}/cases`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: String(f.get("subject")), description: String(f.get("description") ?? "") || null }) }),
      () => form.reset(),
    );
  }

  return (
    <section className="card space-y-3 p-5" aria-labelledby="portal-actions" aria-busy={pending}>
      <h2 id="portal-actions" className="text-sm font-semibold">
        {k.newCase}
      </h2>
      <form onSubmit={openCase} className="space-y-3">
        <label className="field-label">
          {k.subject}
          <input name="subject" required minLength={2} maxLength={200} className="input mt-1" />
        </label>
        <label className="field-label">
          {k.description}
          <textarea name="description" rows={3} maxLength={5000} className="input mt-1" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending || !hydrated} className="btn-primary">
            {k.submit}
          </button>
          <input
            ref={input}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const body = new FormData();
              body.set("file", file);
              send(() => fetch(`${base}/files`, { method: "POST", body }));
            }}
          />
          <button type="button" disabled={pending || !hydrated} onClick={() => input.current?.click()} className="btn-ghost border border-border">
            <Paperclip className="h-4 w-4" aria-hidden />
            {k.upload}
          </button>
        </div>
      </form>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
