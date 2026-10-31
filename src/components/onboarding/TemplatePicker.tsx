"use client";

import { BUSINESS_TEMPLATES_KEYS, type BusinessTemplateKey, type TemplateResultDto } from "@/shared";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/** Line-of-business set-ups; applying one only adds to what the company has. */
export function TemplatePicker({ applied: initial }: { applied: BusinessTemplateKey[] }) {
  const { t } = useI18n();
  const k = t.templates;
  const router = useRouter();
  const [applied, setApplied] = useState(initial);
  const [makeDefault, setMakeDefault] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const apply = (key: BusinessTemplateKey) =>
    startTransition(async () => {
      setError(undefined);
      const res = await api<TemplateResultDto>("/onboarding/template", "POST", { key, makeDefault });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setApplied((a) => [...a, key]);
      setNote(interpolate(k.done, { fields: res.data.fields, products: res.data.products, automations: res.data.automations }));
      router.refresh();
    });

  return (
    <section id="templates" className="card space-y-3 p-5" aria-labelledby="templates-title" aria-busy={pending}>
      <div>
        <h2 id="templates-title" className="text-sm font-semibold">
          {k.title}
        </h2>
        <p className="mt-0.5 text-xs text-fg-muted">{k.subtitle}</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {BUSINESS_TEMPLATES_KEYS.map((key) => (
          <li key={key} className="flex items-start gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{k.items[key].name}</p>
              <p className="text-xs text-fg-muted">{k.items[key].desc}</p>
            </div>
            {applied.includes(key) ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                {k.applied}
              </span>
            ) : (
              <button type="button" disabled={pending} onClick={() => apply(key)} aria-label={`${k.apply}: ${k.items[key].name}`} className="btn-ghost h-8 shrink-0 border border-border text-xs">
                {k.apply}
              </button>
            )}
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
        {k.makeDefault}
      </label>
      {note && <p role="status" className="text-xs text-success">{note}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </section>
  );
}
