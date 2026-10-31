"use client";

import type { OnboardingDto } from "@/shared";
import clsx from "clsx";
import { CheckCircle2, ChevronDown, Circle, Rocket, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { TemplatePicker } from "./TemplatePicker";

const OPEN_KEY = "axis.onboarding.open";

/**
 * Getting started, kept to one line until opened: progress and the next step up
 * front; the checklist, sample data and templates when the member wants them.
 */
export function OnboardingCard({ initial, canManage }: { initial: OnboardingDto; canManage: boolean }) {
  const { t } = useI18n();
  const k = t.onboarding;
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  // A brand-new company starts with it open; afterwards the member's choice is remembered
  useEffect(() => {
    try {
      const saved = localStorage.getItem(OPEN_KEY);
      setOpen(saved === null ? initial.steps.every((s) => !s.done) : saved === "1");
    } catch {
      setOpen(false);
    }
  }, [initial.steps]);
  const toggle = () =>
    setOpen((v) => {
      try {
        localStorage.setItem(OPEN_KEY, v ? "0" : "1");
      } catch {
        // Private mode: the choice just isn't remembered
      }
      return !v;
    });

  const done = state.steps.filter((s) => s.done).length;
  if (state.dismissed) return null;
  const next = state.steps.find((s) => !s.done);

  const call = (method: "POST" | "DELETE" | "PATCH", path: string, body?: object) =>
    startTransition(async () => {
      setError(undefined);
      const res = await api<OnboardingDto>(path, method, body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setState(res.data);
      router.refresh();
    });

  return (
    <section className="card overflow-hidden" aria-labelledby="onboarding-title" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-brand-violet text-white dark:text-bg">
          <Rocket className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="onboarding-title" className="text-sm font-semibold">
            {k.title} <span className="font-normal text-fg-muted">· {interpolate(k.progress, { done, total: state.steps.length })}</span>
          </h2>
          <div className="mt-1.5 h-1.5 max-w-sm overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-brand-violet transition-all duration-500" style={{ width: `${(done / state.steps.length) * 100}%` }} />
          </div>
        </div>
        {next && !open && (
          next.key === "template" ? (
            <button type="button" onClick={() => (setOpen(true), setTemplates(true))} className="btn-primary h-8 text-xs">
              {k.steps.template.label}
            </button>
          ) : (
            <Link href={k.steps[next.key].href} className="btn-primary h-8 text-xs">
              {k.steps[next.key].label}
            </Link>
          )
        )}
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls="onboarding-body" className="btn-ghost h-8 text-xs">
          {open ? k.collapse : k.expand}
          <ChevronDown className={clsx("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {canManage && (
          <button type="button" onClick={() => call("PATCH", "/onboarding", { dismissed: true })} aria-label={k.hide} title={k.hide} className="grid h-8 w-8 place-items-center rounded-md text-fg-subtle hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Always in the page (aria-controls points at it), hidden while collapsed */}
      <div id="onboarding-body" hidden={!open} className="border-t border-border px-4 pb-4 pt-3">
          <p className="text-xs text-fg-muted">{k.subtitle}</p>
          <ol className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            {state.steps.map((s) => {
              const inner = (
                <>
                  {s.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden /> : <Circle className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />}
                  {k.steps[s.key].label}
                </>
              );
              const cls = clsx("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted", s.done && "text-fg-muted line-through");
              return (
                <li key={s.key}>
                  {s.key === "template" ? (
                    <button type="button" onClick={() => setTemplates((v) => !v)} aria-expanded={templates} className={cls}>
                      {inner}
                    </button>
                  ) : (
                    <Link href={k.steps[s.key].href} className={cls}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
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
          {canManage && templates && (
            <div className="mt-4">
              <TemplatePicker applied={state.appliedTemplates} />
            </div>
          )}
      </div>
    </section>
  );
}
