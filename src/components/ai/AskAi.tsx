"use client";

import type { AiTextDto } from "@/shared";
import { Sparkles } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

/** A question about the CRM in plain words; answered from what the user may see. */
export function AskAi() {
  const { t } = useI18n();
  const k = t.ai;
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function ask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const question = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    if (question.length < 3) return;
    startTransition(async () => {
      setError(undefined);
      const res = await api<AiTextDto>("/ai/ask", "POST", { question });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setAnswer(res.data.text);
    });
  }

  return (
    <section className="card p-4" aria-labelledby="ask-ai" aria-busy={pending}>
      <h2 id="ask-ai" className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden />
        {k.ask}
      </h2>
      <form onSubmit={ask} className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="ask-ai-q">
          {k.ask}
        </label>
        <input id="ask-ai-q" name="q" maxLength={500} placeholder={k.askPlaceholder} className="input mt-0 min-w-0 flex-1" />
        <button type="submit" disabled={pending} className="btn-primary shrink-0">
          {pending ? k.working : k.askButton}
        </button>
      </form>
      {answer && <p className="mt-3 whitespace-pre-wrap text-sm">{answer}</p>}
      {answer && <p className="mt-2 text-[11px] text-fg-subtle">{k.hint}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
