"use client";

import type { AiTextDto } from "@/shared";
import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

/** On-demand AI brief of a customer or deal (summary, risk, next step). */
export function AiInsight({ path }: { path: string }) {
  const { t } = useI18n();
  const k = t.ai;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return (
    <section className="card p-4" aria-label={k.title} aria-busy={pending}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          {k.title}
        </h2>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(undefined);
              const res = await api<AiTextDto>(path, "POST");
              if (!res.ok) return setError(errorMessage(t, res.code, res.details));
              setText(res.data.text);
            })
          }
          className="btn-ghost h-8 border border-border text-xs"
        >
          {pending ? k.working : k.insight}
        </button>
      </div>
      {text && <p className="mt-3 whitespace-pre-wrap text-sm">{text}</p>}
      {text && <p className="mt-2 text-[11px] text-fg-subtle">{k.hint}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
