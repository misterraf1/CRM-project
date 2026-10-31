"use client";

import clsx from "clsx";
import { BarChart3, CheckCircle2, CheckSquare, FileText, Flame, Minus, Phone, Plus, Send, Sparkles, UserRound, Users, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { interpolate } from "@/lib/i18n/locales";
import { CountUp } from "./CountUp";

type Tab = "customer" | "quote" | "tasks" | "team" | "reports";
const TABS: { key: Tab; icon: LucideIcon }[] = [
  { key: "customer", icon: UserRound },
  { key: "quote", icon: FileText },
  { key: "tasks", icon: CheckSquare },
  { key: "team", icon: Users },
  { key: "reports", icon: BarChart3 },
];

/** Five small, working pieces of the product: click, change, try. Sample data only. */
export function ProductTour() {
  const { t } = useI18n();
  const k = t.landing.tour;
  const [tab, setTab] = useState<Tab>("customer");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys move between tabs (WAI-ARIA tabs pattern)
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + TABS.length) % TABS.length;
    setTab(TABS[next]!.key);
    refs.current[next]?.focus();
  };

  return (
    <div className="rounded-3xl border border-border bg-surface p-3 shadow-xl shadow-accent/5 sm:p-5">
      <div role="tablist" aria-label={k.title} className="flex gap-1 overflow-x-auto rounded-2xl bg-muted p-1">
        {TABS.map(({ key, icon: Icon }, i) => (
          <button
            key={key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tour-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`tour-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={(e) => onKey(e, i)}
            className={clsx("flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors", tab === key ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {k.tabs[key]}
          </button>
        ))}
        <span className="ml-auto hidden shrink-0 self-center px-3 text-[11px] text-fg-subtle sm:block">{t.landing.sample}</span>
      </div>
      <div role="tabpanel" id={`tour-panel-${tab}`} aria-labelledby={`tour-tab-${tab}`} key={tab} className="animate-[landing-rise_0.35s_ease-out_both] min-h-[22rem] p-2 pt-5 sm:p-4 sm:pt-6">
        {tab === "customer" && <CustomerPanel />}
        {tab === "quote" && <QuotePanel />}
        {tab === "tasks" && <TasksPanel />}
        {tab === "team" && <TeamPanel />}
        {tab === "reports" && <ReportsPanel />}
      </div>
    </div>
  );
}

function CustomerPanel() {
  const { t } = useI18n();
  const k = t.landing.tour.customer;
  const [shown, setShown] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const play = () => {
    timers.current.forEach(clearTimeout);
    setShown(0);
    timers.current = k.events.map((_, i) => setTimeout(() => setShown(i + 1), 450 * (i + 1)));
  };
  // Plays once when the tab opens
  useEffect(() => {
    play();
    return () => timers.current.forEach(clearTimeout);
  }, []);
  const icons = [Send, Phone, FileText, CheckCircle2, CheckCircle2];
  return (
    <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
      <div className="rounded-2xl border border-border bg-bg/60 p-5">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-accent to-brand-violet text-lg font-bold text-white dark:text-bg">{k.name.split(" ").map((x) => x[0]).join("")}</span>
        <p className="mt-3 text-lg font-semibold">{k.name}</p>
        <p className="text-sm text-fg-muted">{k.meta}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
            <Flame className="h-3 w-3" aria-hidden />
            {t.score.levels.hot} · 85
          </span>
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">{t.crm.stages.CUSTOMER}</span>
        </div>
        <button type="button" onClick={play} className="btn-ghost mt-5 h-9 w-full border border-border">
          {k.play}
        </button>
      </div>
      <ol className="relative space-y-3 border-l-2 border-border pl-6">
        {k.events.slice(0, shown).map((e, i) => {
          const Icon = icons[i] ?? CheckCircle2;
          return (
            <li key={e} className="animate-[landing-rise_0.35s_ease-out_both] relative">
              <span className={clsx("absolute -left-[35px] grid h-7 w-7 place-items-center rounded-full ring-4 ring-surface", i >= 3 ? "bg-success text-white dark:text-bg" : "bg-accent-soft text-accent")}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <p className="rounded-xl border border-border bg-bg/60 px-4 py-2.5 text-sm">{e}</p>
            </li>
          );
        })}
        {shown >= k.events.length && (
          <li className="animate-[landing-rise_0.35s_ease-out_both] relative">
            <span className="absolute -left-[35px] grid h-7 w-7 place-items-center rounded-full bg-brand-violet text-white dark:text-bg ring-4 ring-surface">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            </span>
            <p className="rounded-xl border border-brand-violet/30 bg-brand-violet/5 px-4 py-2.5 text-sm font-medium">{k.ai}</p>
          </li>
        )}
      </ol>
    </div>
  );
}

const UNIT = 40_000;
const STEPS = ["draft", "sent", "accepted", "paid"] as const;

function QuotePanel() {
  const { t, locale } = useI18n();
  const k = t.landing.tour.quote;
  const [qty, setQty] = useState(12);
  const [discount, setDiscount] = useState(5);
  const [step, setStep] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const net = Math.round(qty * UNIT * (1 - discount / 100));
  const total = Math.round(net * 1.18);
  const money = (v: number) => formatMoney(v, locale, "AZN");
  const send = () => {
    setStep(1);
    timers.current = [setTimeout(() => setStep(2), 1100), setTimeout(() => setStep(3), 2200)];
  };
  const locked = step > 0;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_15rem]">
      <div className="rounded-2xl border border-border bg-bg/60 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">{k.product}</p>
          <p className="text-sm text-fg-muted">
            {k.unit}: <span className="tabular">{money(UNIT)}</span>
          </p>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-fg-muted">{k.qty}</p>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" disabled={locked || qty <= 1} onClick={() => setQty((q) => q - 1)} aria-label={`${k.qty} −`} className="grid h-10 w-10 place-items-center rounded-lg border border-border hover:bg-muted disabled:opacity-40">
                <Minus className="h-4 w-4" />
              </button>
              <span className="tabular w-10 text-center text-lg font-semibold" aria-live="polite">
                {qty}
              </span>
              <button type="button" disabled={locked || qty >= 50} onClick={() => setQty((q) => q + 1)} aria-label={`${k.qty} +`} className="grid h-10 w-10 place-items-center rounded-lg border border-border hover:bg-muted disabled:opacity-40">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-fg-muted">
              {k.discount}: <span className="tabular">{discount}%</span>
            </span>
            <input type="range" min={0} max={20} value={discount} disabled={locked} onChange={(e) => setDiscount(Number(e.target.value))} className="mt-4 w-full accent-[rgb(var(--accent))]" />
          </label>
        </div>
        <div className="mt-6 flex items-end justify-between border-t border-border pt-4">
          <div>
            <p className="text-xs text-fg-muted">
              {k.total} · {k.vat}
            </p>
            <p className="tabular text-3xl font-bold tracking-tight">
              <CountUp value={total} format={money} ms={350} />
            </p>
          </div>
          {step === 0 ? (
            <button type="button" onClick={send} className="btn-primary h-10">
              <Send className="h-4 w-4" aria-hidden />
              {k.send}
            </button>
          ) : (
            <button type="button" onClick={() => (timers.current.forEach(clearTimeout), setStep(0))} className="btn-ghost h-10 border border-border">
              {k.reset}
            </button>
          )}
        </div>
      </div>
      <ol className="space-y-2" aria-live="polite">
        {STEPS.map((s, i) => (
          <li key={s} className={clsx("flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-all duration-300", i <= step ? (i === 3 ? "border-success/40 bg-success/10 text-success" : "border-accent/40 bg-accent-soft text-accent") : "border-border text-fg-subtle")}>
            <span className={clsx("grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold", i <= step ? (i === 3 ? "bg-success text-white dark:text-bg" : "bg-accent text-white dark:text-bg") : "bg-muted")}>{i <= step ? "✓" : i + 1}</span>
            {k.statuses[s]}
          </li>
        ))}
      </ol>
    </div>
  );
}

function TasksPanel() {
  const { t } = useI18n();
  const k = t.landing.tour.tasks;
  const [done, setDone] = useState<boolean[]>([true, false, false, false]);
  const n = done.filter(Boolean).length;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{k.today}</p>
        <p className="text-sm text-fg-muted" aria-live="polite">
          {interpolate(k.done, { done: n, total: done.length })}
        </p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-success transition-all duration-500" style={{ width: `${(n / done.length) * 100}%` }} />
      </div>
      <ul className="mt-5 space-y-2">
        {k.items.map((item, i) => (
          <li key={item}>
            <label className={clsx("flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors", done[i] ? "border-success/30 bg-success/5" : "border-border bg-bg/60 hover:border-accent/40")}>
              <input type="checkbox" checked={done[i]} onChange={(e) => setDone((d) => d.map((x, j) => (j === i ? e.target.checked : x)))} className="h-5 w-5 accent-[rgb(var(--success))]" />
              <span className={clsx("text-sm", done[i] && "text-fg-muted line-through")}>{item}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TEAM = { week: [6, 4, 5, 2], month: [21, 17, 14, 9] };
const TARGET = { week: 5, month: 18 };

function TeamPanel() {
  const { t } = useI18n();
  const k = t.landing.tour.team;
  const [period, setPeriod] = useState<"week" | "month">("month");
  const values = TEAM[period];
  const max = Math.max(...values, TARGET[period]) * 1.1;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex justify-end">
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
          {(["week", "month"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} className={clsx("rounded-md px-3 py-1.5", period === p ? "bg-surface shadow-sm" : "text-fg-muted")}>
              {k[p]}
            </button>
          ))}
        </div>
      </div>
      <ul className="mt-5 space-y-4">
        {k.people.map((name, i) => {
          const v = values[i]!;
          const hit = v >= TARGET[period];
          return (
            <li key={name} className="grid grid-cols-[5rem_1fr_4.5rem] items-center gap-3">
              <span className="text-sm font-medium">{name}</span>
              <div className="relative h-8 rounded-lg bg-muted">
                <div className={clsx("h-full rounded-lg transition-all duration-700", hit ? "bg-gradient-to-r from-success/70 to-success" : "bg-gradient-to-r from-accent/60 to-accent")} style={{ width: `${(v / max) * 100}%` }} />
                <div className="absolute inset-y-0 border-l-2 border-dashed border-fg/40" style={{ left: `${(TARGET[period] / max) * 100}%` }} title={k.target} />
              </div>
              <span className="tabular text-right text-sm">
                {v} {k.deals}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 flex items-center gap-2 text-xs text-fg-subtle">
        <span className="inline-block h-3 border-l-2 border-dashed border-fg/40" aria-hidden />
        {k.target}: {TARGET[period]}
      </p>
    </div>
  );
}

const REVENUE = [182, 214, 199, 256, 301, 338];
const FUNNEL = [120, 74, 41, 23];

function ReportsPanel() {
  const { t, locale } = useI18n();
  const k = t.landing.tour.reports;
  const [active, setActive] = useState(REVENUE.length - 1);
  const max = Math.max(...REVENUE);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="rounded-2xl border border-border bg-bg/60 p-5">
        <div className="flex items-baseline justify-between">
          <p className="font-semibold">{k.revenue}</p>
          <p className="tabular text-xl font-bold" aria-live="polite">
            {formatMoney(REVENUE[active]! * 100_000, locale, "AZN")}
          </p>
        </div>
        <div className="mt-5 flex h-44 items-end gap-2">
          {REVENUE.map((v, i) => (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-label={`${k.months[i]}: ${formatMoney(v * 100_000, locale, "AZN")}`}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
            >
              <span className={clsx("w-full rounded-t-lg transition-all duration-500", i === active ? "bg-gradient-to-t from-accent to-brand-violet" : "bg-accent/25 hover:bg-accent/40")} style={{ height: `${(v / max) * 100}%` }} />
              <span className="text-[11px] text-fg-muted">{k.months[i]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-bg/60 p-5">
        <p className="font-semibold">{k.funnel}</p>
        <ul className="mt-5 space-y-2">
          {FUNNEL.map((v, i) => (
            <li key={i} className="flex flex-col items-center">
              <div className={clsx("flex h-10 items-center justify-between rounded-lg px-3 text-xs font-medium text-white dark:text-bg", ["bg-accent", "bg-brand-violet", "bg-accent", "bg-success"][i])} style={{ width: `${40 + (v / FUNNEL[0]!) * 60}%` }}>
                <span>{k.stages[i]}</span>
                <span className="tabular">{v}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
