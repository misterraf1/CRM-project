"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { useHydrated } from "@/lib/use-hydrated";

/** The customer accepts or declines a quote with their name (and an optional comment). */
export function QuoteResponseForm({ token }: { token: string }) {
  const { t } = useI18n();
  const k = t.sales;
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const decision = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "reject" ? "reject" : "accept";
    if (decision === "reject" && !window.confirm(k.confirmReject)) return;
    startTransition(async () => {
      setError(undefined);
      const res = await fetch(`/api/v1/public/docs/${encodeURIComponent(token)}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, name: String(f.get("name")), comment: String(f.get("comment") ?? "") }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string; details?: unknown } } | null;
        return setError(errorMessage(t, body?.error?.code ?? "INTERNAL", body?.error?.details));
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-5" aria-labelledby="respond-title">
      <h2 id="respond-title" className="text-sm font-semibold">{k.respondTitle}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field-label">
          {k.yourName}
          <input name="name" required minLength={2} maxLength={100} autoComplete="name" className="input" />
        </label>
        <label className="field-label">
          {k.comment}
          <input name="comment" maxLength={1000} className="input" />
        </label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="accept" disabled={pending || !hydrated} className="btn-primary">
          {k.accept}
        </button>
        <button type="submit" name="decision" value="reject" disabled={pending || !hydrated} className="btn-ghost border border-border">
          {k.reject}
        </button>
      </div>
    </form>
  );
}
