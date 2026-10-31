"use client";

import clsx from "clsx";
import { BadgeCheck, ChevronRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { CountUp } from "./CountUp";

const AMOUNTS = [420_000, 480_000, 180_000, 240_000, 150_000];
const START = [1, 0, 2, 3, 0];
const WON = 3;
const TONES = ["bg-accent", "bg-brand-violet", "bg-warning", "bg-success"];

/**
 * The hero's live sales board: it plays a deal forward on its own until the visitor
 * takes over — drag a card, or tap it to move it on. Winning a deal "creates" its invoice.
 */
export function PipelineDemo() {
  const { t, locale } = useI18n();
  const k = t.landing.pipeline;
  const [stages, setStages] = useState(START);
  const [toast, setToast] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const move = (i: number, to: number) =>
    setStages((s) => {
      if (s[i] === to) return s;
      const next = s.map((x, j) => (j === i ? to : x));
      if (to === WON && s[i] !== WON) {
        clearTimeout(toastTimer.current);
        setToast(`${k.deals[i]!.t} — ${k.invoiced}`);
        toastTimer.current = setTimeout(() => setToast(null), 2600);
      }
      return next;
    });

  // Autoplay: the furthest open deal moves on; when all are won, start over
  useEffect(() => {
    if (!auto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setStages((s) => {
        const open = s.map((st, i) => ({ st, i })).filter((x) => x.st < WON);
        if (!open.length) return START;
        const pick = open.sort((a, b) => b.st - a.st)[0]!;
        if (pick.st + 1 === WON) {
          clearTimeout(toastTimer.current);
          setToast(`${k.deals[pick.i]!.t} — ${k.invoiced}`);
          toastTimer.current = setTimeout(() => setToast(null), 2600);
        }
        return s.map((x, j) => (j === pick.i ? x + 1 : x));
      });
    }, 2600);
    return () => clearInterval(id);
  }, [auto, k]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const takeOver = () => setAuto(false);
  const openSum = stages.reduce((a, st, i) => (st < WON ? a + AMOUNTS[i]! : a), 0);
  const wonSum = stages.reduce((a, st, i) => (st === WON ? a + AMOUNTS[i]! : a), 0);
  const money = (v: number) => formatMoney(v, locale, "AZN");

  const onDrop = (e: DragEvent, col: number) => {
    e.preventDefault();
    const i = Number(e.dataTransfer.getData("text/plain"));
    if (Number.isInteger(i)) move(i, col);
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="relative" onPointerDown={takeOver}>
      <div className="rounded-2xl border border-border bg-surface/90 p-3 shadow-2xl shadow-accent/10 backdrop-blur sm:p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
          </span>
          <p className="ml-2 text-sm font-semibold">{k.title}</p>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-fg-muted">{t.landing.sample}</span>
          {!auto && (
            <button type="button" onClick={() => (setStages(START), setAuto(true))} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-muted hover:text-fg">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {k.replay}
            </button>
          )}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-muted/70 px-3 py-2">
            <p className="text-[11px] text-fg-muted">{k.forecast}</p>
            <p className="tabular text-lg font-bold">
              <CountUp value={openSum} format={money} />
            </p>
          </div>
          <div className="rounded-xl bg-success/10 px-3 py-2">
            <p className="text-[11px] text-success">{k.won}</p>
            <p className="tabular text-lg font-bold text-success">
              <CountUp value={wonSum} format={money} />
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {k.stages.map((name, col) => {
            const cards = stages.map((st, i) => ({ st, i })).filter((x) => x.st === col);
            return (
              <section
                key={name}
                aria-label={name}
                onDragOver={(e) => (e.preventDefault(), setOver(col))}
                onDragLeave={() => setOver((o) => (o === col ? null : o))}
                onDrop={(e) => onDrop(e, col)}
                className={clsx("min-h-36 rounded-xl border p-2 transition-colors", over === col ? "border-accent bg-accent-soft" : "border-border bg-bg/60")}
              >
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-fg-muted">
                  <span className={clsx("h-1.5 w-1.5 rounded-full", TONES[col])} />
                  <span className="truncate">{name}</span>
                  <span className="ml-auto tabular text-fg-subtle">{cards.length}</span>
                </p>
                <ul className="space-y-1.5">
                  {cards.map(({ i }) => {
                    const d = k.deals[i]!;
                    const won = col === WON;
                    return (
                      <li
                        key={i}
                        draggable
                        onDragStart={(e) => (e.dataTransfer.setData("text/plain", String(i)), setDragging(i), takeOver())}
                        onDragEnd={() => (setDragging(null), setOver(null))}
                        className={clsx("animate-[landing-rise_0.35s_ease-out_both] cursor-grab rounded-lg border bg-surface shadow-sm active:cursor-grabbing", won ? "border-success/40" : "border-border", dragging === i && "opacity-50")}
                      >
                        <button
                          type="button"
                          disabled={won}
                          onClick={() => (takeOver(), move(i, Math.min(WON, col + 1)))}
                          className="group flex w-full items-start gap-1 p-2 text-left disabled:cursor-default"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium">{d.t}</span>
                            <span className="block truncate text-[10px] text-fg-muted">{d.c}</span>
                            <span className={clsx("tabular mt-1 block text-[11px] font-semibold", won ? "text-success" : "text-fg")}>{money(AMOUNTS[i]!)}</span>
                            {!won && <span className="sr-only">{k.next}</span>}
                          </span>
                          {won ? <BadgeCheck className="h-4 w-4 shrink-0 text-success" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-fg-subtle">{k.hint}</p>
      </div>

      <div role="status" aria-live="polite" className="pointer-events-none absolute -bottom-4 left-1/2 w-max max-w-[90%] -translate-x-1/2">
        {toast && (
          <p className="animate-[landing-rise_0.3s_ease-out_both] flex items-center gap-2 rounded-xl border border-success/30 bg-surface px-3 py-2 text-xs font-medium shadow-lg">
            <BadgeCheck className="h-4 w-4 text-success" aria-hidden />
            {toast}
          </p>
        )}
      </div>
    </div>
  );
}
