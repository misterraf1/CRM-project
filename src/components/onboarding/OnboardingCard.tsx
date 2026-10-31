"use client";

import type { OnboardingDto } from "@/shared";
import clsx from "clsx";
import { CheckCircle2, Circle, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { TemplatePicker } from "./TemplatePicker";

/** Dashboard checklist for a new company: steps, sample data, business templates. */
export function OnboardingCard({ initial, canManage }: { initial: OnboardingDto; canManage: boolean }) {
  const { t } = useI18n();
  const k = t.onboarding;
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const done = state.steps.filter((s) => s.done).length;
  if (state.dismissed) return null;

  const call = (method: "POST" | "DELETE" | "PATCH", path: string, body?: object) =>
    startTransition(async () => {
      setError(undefined);
      const res = await api<OnboardingDto>(path, method, body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setState(res.data);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <section className="card p-5" aria-labelledby="onboarding-title" aria-busy={pending}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="onboarding-title" className="text-sm font-semibold">
              {k.title}
            </h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              {k.subtitle} · {interpolate(k.progress, { done, total: state.steps.length })}
            </p>
          </div>
          {canManage && (
            <button type="button" onClick={() => call("PATCH", "/onboarding", { dismissed: true })} aria-label={k.hide} title={k.hide} className="grid h-8 w-8 place-items-center rounded-md text-fg-subtle hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-accent" style={{ width: `${(done / state.steps.length) * 100}%` }} />
        </div>
        <ol className="mt-3 grid gap-1 sm:grid-cols-2">
          {state.steps.map((s) => (
            <li key={s.key}>
              <Link href={k.steps[s.key].href} className={clsx("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted", s.done && "text-fg-muted line-through")}>
                {s.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden /> : <Circle className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />}
                {k.steps[s.key].label}
              </Link>
            </li>
          ))}
        </ol>
        {canManage && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
            {state.demo ? (
              <button type="button" disabled={pending} onClick={() => window.confirm(k.confirmRemove) && call("DELETE", "/onboarding/demo")} className="btn-ghost h-8 border border-border text-xs">
                {k.demoRemove}
              </button>
            ) : (
              <button type="button" disabled={pending} onClick={() => call("POST", "/onboarding/demo")} className="btn-ghost h-8 border border-border text-xs">
                {k.demoAdd}
              </button>
            )}
            <span className="text-xs text-fg-subtle">{k.demoHint}</span>
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      </section>
      {canManage && !state.steps.find((s) => s.key === "template")?.done && <TemplatePicker applied={state.appliedTemplates} />}
    </div>
  );
}
