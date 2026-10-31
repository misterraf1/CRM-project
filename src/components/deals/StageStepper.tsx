"use client";

import { LOST_REASONS, type PipelineDto } from "@/shared";
import clsx from "clsx";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/**
 * The deal's journey as a row of stages: done ones ticked, the current one
 * highlighted; tapping another stage moves the deal there ("Lost" asks why).
 */
export function StageStepper({ dealId, pipeline, stageId, canMove }: { dealId: string; pipeline: PipelineDto; stageId: string; canMove: boolean }) {
  const { t } = useI18n();
  const k = t.record;
  const router = useRouter();
  const [current, setCurrent] = useState(stageId);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const open = pipeline.stages.filter((s) => s.kind === "open");
  const won = pipeline.stages.find((s) => s.kind === "won");
  const lost = pipeline.stages.find((s) => s.kind === "lost");
  const steps = [...open, ...(won ? [won] : [])];
  const at = steps.findIndex((s) => s.id === current);

  const move = (to: string, lostReason?: string) =>
    startTransition(async () => {
      setError(undefined);
      const before = current;
      setCurrent(to);
      const res = await api(`/deals/${dealId}/move`, "POST", { stageId: to, ...(lostReason ? { lostReason } : {}) });
      if (!res.ok) {
        setCurrent(before);
        return setError(errorMessage(t, res.code, res.details));
      }
      setAsking(null);
      router.refresh();
    });

  return (
    <div aria-busy={pending}>
      <ol aria-label={k.stage} className="flex gap-1 overflow-x-auto pb-1">
        {steps.map((s, i) => {
          const done = at >= 0 && i < at;
          const here = s.id === current;
          return (
            <li key={s.id} className="min-w-[7.5rem] flex-1">
              <button
                type="button"
                disabled={!canMove || here || pending}
                onClick={() => move(s.id)}
                aria-current={here ? "step" : undefined}
                aria-label={here ? `${s.name} — ${k.current}` : interpolate(k.moveTo, { stage: s.name })}
                className={clsx(
                  "flex h-10 w-full items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors",
                  here
                    ? s.kind === "won"
                      ? "bg-success text-white dark:text-bg"
                      : "bg-accent text-accent-fg"
                    : done
                      ? "bg-accent-soft text-accent hover:bg-accent/20"
                      : "bg-muted text-fg-muted hover:bg-accent-soft hover:text-accent",
                  "disabled:cursor-default",
                )}
              >
                {done && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span className="truncate">{s.name}</span>
              </button>
            </li>
          );
        })}
        {lost && (
          <li className="min-w-[6.5rem]">
            <button
              type="button"
              disabled={!canMove || current === lost.id || pending}
              onClick={() => setAsking(lost.id)}
              aria-current={current === lost.id ? "step" : undefined}
              className={clsx(
                "flex h-10 w-full items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors disabled:cursor-default",
                current === lost.id ? "bg-danger text-white dark:text-bg" : "border border-dashed border-danger/40 text-danger hover:bg-danger/10",
              )}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {lost.name}
            </button>
          </li>
        )}
      </ol>
      {asking && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 p-2">
          <span className="text-xs text-fg-muted">{k.lostHint}:</span>
          {LOST_REASONS.map((reason) => (
            <button key={reason} type="button" disabled={pending} onClick={() => move(asking, reason)} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:border-danger/50 hover:text-danger">
              {t.deals.reasons[reason]}
            </button>
          ))}
          <button type="button" onClick={() => setAsking(null)} className="ml-auto text-xs text-fg-muted hover:text-fg">
            {t.deals.cancel}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
