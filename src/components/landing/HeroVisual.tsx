import clsx from "clsx";
import { BadgeCheck, CalendarDays, Flame, Globe, Sparkles } from "lucide-react";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";

/**
 * A collage of the product drawn in markup (no screenshots to go stale): messages
 * from three channels flow in beside the sales board, with live notices floating over.
 * Purely illustrative, so hidden from screen readers.
 */
export function HeroVisual({ t }: { t: Dictionary }) {
  const m = t.landing.mock;
  const bubbles = [
    { ch: "WHATSAPP" as const, name: "Leyla", text: m.msg1, delay: "0.2s" },
    { ch: "INSTAGRAM" as const, name: "Orxan", text: m.msg2, delay: "0.45s" },
    { ch: "TELEGRAM" as const, name: "Nigar", text: m.msg3, delay: "0.7s" },
  ];
  const columns = [
    { title: m.col1, tone: "bg-accent", cards: [{ t: m.deal2, a: "1 800 ₼" }] },
    { title: m.col2, tone: "bg-brand-violet", cards: [{ t: m.deal1, a: "4 250 ₼" }] },
    { title: m.col3, tone: "bg-success", cards: [{ t: m.deal3, a: "6 900 ₼" }] },
  ];
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-xl select-none lg:max-w-none">
      {/* Window */}
      <div className="relative rounded-2xl border border-border bg-surface/90 p-3 shadow-2xl shadow-accent/10 backdrop-blur sm:p-4 lg:[transform:perspective(1600px)_rotateY(-8deg)_rotateX(4deg)]">
        <div className="mb-3 flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
          <span className="ml-3 h-5 flex-1 rounded-md bg-muted" />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1.25fr]">
          <div className="rounded-xl border border-border bg-bg/60 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{m.inbox}</p>
            <ul className="space-y-2">
              {bubbles.map((b) => (
                <li key={b.name} className="landing-rise flex items-start gap-2 rounded-lg bg-surface p-2 shadow-sm" style={{ animationDelay: b.delay }}>
                  <ChannelIcon channel={b.ch} label="" size="sm" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold">{b.name}</p>
                    <p className="truncate text-[11px] text-fg-muted">{b.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-bg/60 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{m.board}</p>
            <div className="grid grid-cols-3 gap-2">
              {columns.map((c, i) => (
                <div key={c.title} className="space-y-1.5">
                  <p className="flex items-center gap-1 text-[10px] font-medium text-fg-muted">
                    <span className={clsx("h-1.5 w-1.5 rounded-full", c.tone)} />
                    {c.title}
                  </p>
                  {c.cards.map((card) => (
                    <div key={card.t} className={clsx("rounded-lg border border-border bg-surface p-2 shadow-sm", i === 1 && "landing-float")}>
                      <p className="truncate text-[11px] font-medium">{card.t}</p>
                      <p className="tabular text-[10px] text-fg-muted">{card.a}</p>
                    </div>
                  ))}
                  <div className="h-8 rounded-lg border border-dashed border-border" />
                </div>
              ))}
            </div>
            {/* Revenue line */}
            <svg viewBox="0 0 200 48" className="mt-3 h-12 w-full text-accent">
              <defs>
                <linearGradient id="hero-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="currentColor" stopOpacity="0.25" />
                  <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 40 C25 36 35 30 55 31 S90 18 110 22 150 8 170 10 195 4 200 3 L200 48 L0 48 Z" fill="url(#hero-area)" />
              <path d="M0 40 C25 36 35 30 55 31 S90 18 110 22 150 8 170 10 195 4 200 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>

      {/* Floating notices */}
      <div className="landing-float absolute -left-3 -top-5 hidden items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium shadow-lg sm:flex lg:-left-6" style={{ animationDelay: "0.5s" }}>
        <Globe className="h-4 w-4 text-accent" />
        {m.lead}
      </div>
      <div className="landing-float absolute -right-2 top-[58%] hidden items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium shadow-lg sm:flex lg:-right-8" style={{ animationDelay: "1.4s" }}>
        <BadgeCheck className="h-4 w-4 text-success" />
        {m.paid}
      </div>
      <div className="landing-float absolute -bottom-5 left-6 hidden items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium shadow-lg sm:flex" style={{ animationDelay: "2.1s" }}>
        <CalendarDays className="h-4 w-4 text-brand-violet" />
        {m.meeting}
      </div>
      <div className="landing-float absolute -bottom-3 right-4 hidden items-center gap-2 rounded-xl border border-brand-violet/30 bg-surface px-3 py-2 text-xs font-medium shadow-lg md:flex" style={{ animationDelay: "0.9s" }}>
        <Sparkles className="h-4 w-4 text-brand-violet" />
        {m.ai}
        <Flame className="h-3.5 w-3.5 text-danger" />
      </div>
    </div>
  );
}
