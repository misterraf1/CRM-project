"use client";

import type { PublicFormDto } from "@/shared";
import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { useHydrated } from "@/lib/use-hydrated";

const TYPES = { email: "email", phone: "tel" } as Record<string, string>;
const AUTO = { name: "name", email: "email", phone: "tel", company: "organization" } as Record<string, string>;

/** The hosted form (also shown inside the iframe on the customer's website). */
export function PublicForm({ formKey, form }: { formKey: string; form: PublicFormDto }) {
  const { t } = useI18n();
  const k = t.forms;
  const hydrated = useHydrated();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const values = Object.fromEntries(form.fields.map((f) => [f.key, String(data.get(f.key) ?? "")]));
    setSending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/v1/public/forms/${encodeURIComponent(formKey)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values, website: String(data.get("website") ?? ""), page: document.referrer || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setError(errorMessage(t, body?.error?.code ?? "INTERNAL", body?.error?.details));
      setDone(body.message);
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-lg bg-success/10 p-4 text-sm text-success">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {done}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-busy={sending}>
      {form.fields.map((f) => (
        <label key={f.key} className="field-label">
          {f.label}
          {f.required && <span aria-hidden className="text-danger"> *</span>}
          {f.key === "message" ? (
            <textarea name={f.key} required={f.required} maxLength={2000} rows={4} className="input mt-1" />
          ) : (
            <input name={f.key} type={TYPES[f.key] ?? "text"} autoComplete={AUTO[f.key]} required={f.required} maxLength={200} className="input mt-1" />
          )}
        </label>
      ))}
      {/* Honeypot: hidden from people, filled by bots */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={sending || !hydrated} className="btn-primary w-full">
        {sending ? k.sending : k.send}
      </button>
    </form>
  );
}
