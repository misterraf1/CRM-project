"use client";

import { LOST_REASONS, type DealDto, type PipelineDto, type StageDto } from "@/shared";
import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type DragEvent, type FormEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api/client";
import { formatMoney, parseMoneyInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

const STEP = 1024;

/** Position between two neighbours (fractional ordering: one row update per move). */
function positionBetween(before?: DealDto, after?: DealDto) {
  if (before && after) return (before.position + after.position) / 2;
  if (before) return before.position + STEP;
  if (after) return after.position - STEP;
  return STEP;
}

interface PendingMove {
  deal: DealDto;
  stage: StageDto;
  position?: number;
}

export function Board({ pipeline, deals: initial }: { pipeline: PipelineDto; deals: DealDto[] }) {
  const { t, locale } = useI18n();
  const d = t.deals;
  const router = useRouter();
  const [deals, setDeals] = useState(initial);
  const [error, setError] = useState<string>();
  const [lostMove, setLostMove] = useState<PendingMove | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();
  const dragged = useRef<string | null>(null);

  // Server data wins after every refresh
  useEffect(() => {
    setDeals(initial);
  }, [initial]);

  const columns = useMemo(
    () =>
      pipeline.stages.map((stage) => {
        const items = deals.filter((x) => x.stageId === stage.id).sort((a, b) => a.position - b.position);
        return { stage, items, total: items.reduce((a, x) => a + x.amount, 0) };
      }),
    [deals, pipeline.stages],
  );

  function move({ deal, stage, position }: PendingMove, lostReason?: string) {
    if (stage.kind === "lost" && !lostReason && deal.stageId !== stage.id) {
      setLostMove({ deal, stage, position });
      return;
    }
    const before = deals;
    const optimisticPos = position ?? positionBetween(columns.find((c) => c.stage.id === stage.id)?.items.at(-1));
    setDeals((all) => all.map((x) => (x.id === deal.id ? { ...x, stageId: stage.id, position: optimisticPos } : x)));
    setError(undefined);
    startTransition(async () => {
      const res = await api<DealDto>(`/deals/${deal.id}/move`, "POST", { stageId: stage.id, position, lostReason });
      if (!res.ok) {
        setDeals(before);
        setError(errorMessage(t, res.code));
        return;
      }
      router.refresh(); // forecast and column totals
    });
  }

  function onDrop(e: DragEvent, stage: StageDto, beforeDeal?: DealDto) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    const deal = deals.find((x) => x.id === (dragged.current ?? e.dataTransfer.getData("text/plain")));
    dragged.current = null;
    if (!deal || deal.id === beforeDeal?.id) return;
    const items = columns.find((c) => c.stage.id === stage.id)!.items.filter((x) => x.id !== deal.id);
    const idx = beforeDeal ? items.findIndex((x) => x.id === beforeDeal.id) : items.length;
    move({ deal, stage, position: positionBetween(items[idx - 1], items[idx]) });
  }

  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = parseMoneyInput(String(f.get("amount") || "0"));
    if (amount === null) return setError(t.errors.VALIDATION_FAILED);
    const form = e.currentTarget;
    startTransition(async () => {
      const res = await api<DealDto>("/deals", "POST", { title: String(f.get("title")), amount, pipelineId: pipeline.id });
      if (!res.ok) return setError(errorMessage(t, res.code));
      form.reset();
      setCreating(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setCreating((v) => !v)} className="btn-primary h-8 text-xs">
          <Plus className="h-4 w-4" aria-hidden />
          {d.new}
        </button>
        <p className="text-xs text-fg-subtle">{d.closedHint}</p>
      </div>
      {creating && (
        <form onSubmit={create} className="card grid gap-2 p-3 sm:grid-cols-[1fr_160px_auto_auto]">
          <input name="title" required maxLength={150} placeholder={d.dealTitle} aria-label={d.dealTitle} className="input mt-0" autoFocus />
          <input name="amount" inputMode="decimal" placeholder={d.amount} aria-label={d.amount} className="input mt-0" />
          <button type="submit" className="btn-primary">
            {d.create}
          </button>
          <button type="button" onClick={() => setCreating(false)} className="btn-ghost">
            {d.cancel}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Focusable so the board can be scrolled with the keyboard even when it has no cards */}
      <div role="region" aria-label={d.title} tabIndex={0} className="-mx-4 overflow-x-auto px-4 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-accent/60 lg:-mx-6 lg:px-6">
        {/* Columns share the width (min 220px each); narrower screens scroll horizontally */}
        <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3">
          {columns.map(({ stage, items, total }) => (
            <section
              key={stage.id}
              aria-label={stage.name}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(stage.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
              }}
              onDrop={(e) => onDrop(e, stage)}
              className={clsx(
                "flex min-w-0 flex-col rounded-xl border bg-muted/40 transition-colors",
                dragOver === stage.id ? "border-accent bg-accent-soft/40" : "border-border",
              )}
            >
              <header className="border-b border-border px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h2
                    className={clsx(
                      "truncate text-sm font-semibold",
                      stage.kind === "won" && "text-success",
                      stage.kind === "lost" && "text-danger",
                    )}
                  >
                    {stage.name}
                  </h2>
                  {stage.kind === "open" && <span className="text-[11px] text-fg-subtle">{stage.probability}%</span>}
                </div>
                <p className="tabular mt-0.5 text-xs text-fg-muted">
                  {interpolate(d.count, { n: items.length })} · {formatMoney(total, locale)}
                </p>
              </header>
              <ol className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                {items.length === 0 && <li className="py-6 text-center text-xs text-fg-subtle">{d.emptyColumn}</li>}
                {items.map((deal) => (
                  <li
                    key={deal.id}
                    draggable
                    onDragStart={(e) => {
                      dragged.current = deal.id;
                      e.dataTransfer.setData("text/plain", deal.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDrop(e, stage, deal)}
                    className="cursor-grab rounded-lg border border-border bg-surface p-2.5 shadow-sm active:cursor-grabbing"
                  >
                    <Link href={`/deals/${deal.id}`} draggable={false} className="block text-sm font-medium leading-snug hover:text-accent">
                      {deal.title}
                    </Link>
                    {deal.contact && <p className="mt-0.5 truncate text-xs text-fg-muted">{deal.contact.name}</p>}
                    {deal.lostReason && <p className="mt-0.5 text-xs text-danger">{d.reasons[deal.lostReason as keyof typeof d.reasons] ?? deal.lostReason}</p>}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="tabular text-sm font-semibold">{formatMoney(deal.amount, locale, deal.currency)}</span>
                      {deal.owner && (
                        <span title={deal.owner.name}>
                          <Avatar name={deal.owner.name} size="sm" />
                        </span>
                      )}
                    </div>
                    {/* Keyboard and touch alternative to drag & drop */}
                    <select
                      aria-label={`${d.stage}: ${deal.title}`}
                      value={deal.stageId}
                      onChange={(e) => move({ deal, stage: pipeline.stages.find((s) => s.id === e.target.value)! })}
                      className="mt-2 h-7 w-full rounded-md border border-border bg-surface px-1.5 text-xs text-fg-muted"
                    >
                      {pipeline.stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>

      {lostMove && <LostReasonDialog onCancel={() => setLostMove(null)} onConfirm={(reason) => (move(lostMove, reason), setLostMove(null))} />}
    </div>
  );
}

function LostReasonDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: string) => void }) {
  const { t } = useI18n();
  const d = t.deals;
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<string>(LOST_REASONS[0]);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onCancel} className="w-[min(92vw,360px)] rounded-xl border border-border bg-surface p-0 text-fg backdrop:bg-black/40">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(reason);
        }}
        className="p-5"
      >
        <h2 className="text-base font-semibold">{d.lostTitle}</h2>
        <fieldset className="mt-3 space-y-1.5">
          {LOST_REASONS.map((r) => (
            <label key={r} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-[rgb(var(--accent))]" />
              {d.reasons[r]}
            </label>
          ))}
        </fieldset>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost">
            {d.cancel}
          </button>
          <button type="submit" className="btn-primary">
            {d.lostConfirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
