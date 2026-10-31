import type { ChannelType, PlanDto } from "@/shared";
import clsx from "clsx";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  FileText,
  Handshake,
  LayoutGrid,
  Lock,
  MessagesSquare,
  Server,
  ShieldCheck,
  UserCog,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { OwnerSwitch } from "@/components/landing/OwnerSwitch";
import { PipelineDemo } from "@/components/landing/PipelineDemo";
import { ProductTour } from "@/components/landing/ProductTour";
import { Reveal } from "@/components/landing/Reveal";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { apiPublic } from "@/lib/api/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/cookies";
import { APP_NAME } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: { absolute: `${APP_NAME} — CRM` },
  description: "WhatsApp, Instagram, Telegram, sales, quotes, invoices, orders and service in one CRM.",
};

const CHANNELS: ChannelType[] = ["WHATSAPP", "INSTAGRAM", "TELEGRAM", "MESSENGER", "EMAIL", "WEBCHAT"];

type FeatureKey = keyof Awaited<ReturnType<typeof getI18n>>["t"]["landing"]["features"];

/** Four columns with no gaps: a 2×2 tile, then rows of 1+1, 1+1 and 2+1+1 */
const FEATURES: { key: FeatureKey; icon: LucideIcon; tone: string; span: string }[] = [
  { key: "customers", icon: Users, tone: "from-accent/20 to-brand-teal/10", span: "lg:col-span-2 lg:row-span-2" },
  { key: "pipeline", icon: Handshake, tone: "from-brand-violet/20 to-accent/5", span: "" },
  { key: "docs", icon: FileText, tone: "from-brand-teal/20 to-accent/5", span: "" },
  { key: "tasks", icon: CalendarDays, tone: "from-accent/15 to-brand-violet/10", span: "" },
  { key: "team", icon: UserCog, tone: "from-brand-teal/20 to-brand-violet/10", span: "" },
  { key: "automation", icon: Workflow, tone: "from-brand-violet/20 to-brand-teal/10", span: "lg:col-span-2" },
  { key: "inbox", icon: MessagesSquare, tone: "from-accent/15 to-brand-teal/10", span: "" },
  { key: "analytics", icon: BarChart3, tone: "from-brand-violet/15 to-accent/10", span: "" },
];

const SECURITY_ICONS: LucideIcon[] = [Lock, UserCog, ShieldCheck, LayoutGrid, Server];

/** The public front page: what Axis does, prices from the plans on sale, sign up or sign in. */
export default async function LandingPage() {
  const [{ t, locale }, jar, plansRes] = await Promise.all([getI18n(), cookies(), apiPublic<{ plans: PlanDto[]; trialDays: number }>("/v1/public/plans")]);
  const k = t.landing;
  const signedIn = !!(jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE));
  const plans = plansRes.ok ? plansRes.data.plans : [];
  const trialDays = plansRes.ok ? plansRes.data.trialDays : 14;
  const popular = plans.length >= 3 ? plans[1]!.code : null;
  const primaryHref = signedIn ? "/dashboard" : "/signup";
  const primaryLabel = signedIn ? k.toApp : k.start;

  return (
    <div className="min-h-screen overflow-x-clip bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        {t.shell.skipToContent}
      </a>
      <LandingHeader signedIn={signedIn} />

      <main id="main">
        {/* ── Hero ─────────────────────────────────── */}
        <section className="relative isolate">
          {/* Drifting colour fields behind everything */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="landing-drift absolute -left-32 -top-40 h-[34rem] w-[34rem] rounded-full bg-accent/25 blur-3xl" />
            <div className="landing-drift absolute -right-24 top-10 h-[30rem] w-[30rem] rounded-full bg-brand-violet/20 blur-3xl" style={{ animationDelay: "-6s" }} />
            <div className="landing-drift absolute bottom-[-12rem] left-1/3 h-[26rem] w-[26rem] rounded-full bg-brand-teal/20 blur-3xl" style={{ animationDelay: "-11s" }} />
            <div className="absolute inset-0 bg-[radial-gradient(rgb(var(--fg)/0.07)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
          </div>
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-20 pt-12 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:pb-28 lg:pt-16">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-xs font-medium text-fg-muted backdrop-blur">
                <span className="landing-pulse h-2 w-2 rounded-full bg-success" />
                {k.badge}
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl xl:text-[3.4rem]">
                {k.title1} <span className="landing-gradient-text">{k.title2}</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-fg-muted sm:text-lg">{k.subtitle}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={primaryHref} className="btn-primary h-11 px-5 text-base shadow-lg shadow-accent/25">
                  {primaryLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                {!signedIn && (
                  <Link href="/login" className="btn-ghost h-11 border border-border bg-surface/70 px-5 text-base backdrop-blur">
                    {k.login}
                  </Link>
                )}
              </div>
              {!signedIn && <p className="mt-4 text-sm text-fg-subtle">{interpolate(k.trial, { days: trialDays })}</p>}
              <a href="#tour" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                {k.secondary}
                <ArrowRight className="h-3.5 w-3.5 rotate-90" aria-hidden />
              </a>
            </div>
            <PipelineDemo />
          </div>
        </section>

        {/* ── For the owner: before / after ───────── */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
          <Reveal>
            <SectionHead title={k.owner.title} subtitle={k.owner.subtitle} />
            <div className="mt-10">
              <OwnerSwitch />
            </div>
          </Reveal>
        </section>

        {/* ── Interactive tour ─────────────────────── */}
        <section id="tour" className="scroll-mt-20 border-y border-border bg-gradient-to-b from-surface/60 to-bg">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
            <Reveal>
              <SectionHead title={k.tour.title} subtitle={k.tour.subtitle} />
              <div className="mt-10">
                <ProductTour />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Features (bento) ─────────────────────── */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 lg:py-28">
          <SectionHead title={k.featuresTitle} subtitle={k.featuresSubtitle} />
          <ul className="mt-12 grid auto-rows-[minmax(11rem,auto)] gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ key, icon: Icon, tone, span }) => (
              <li key={key} className={clsx("group relative overflow-hidden rounded-2xl border border-border bg-surface p-6 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-accent/5", span)}>
                <div aria-hidden className={clsx("absolute inset-0 -z-0 bg-gradient-to-br opacity-70 transition-opacity group-hover:opacity-100", tone)} />
                <div className="relative">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface shadow-sm ring-1 ring-border">
                    <Icon className="h-5 w-5 text-accent" aria-hidden />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{k.features[key].title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{k.features[key].text}</p>
                  {key === "inbox" && (
                    <div aria-hidden className="mt-4 flex flex-wrap gap-1.5">
                      {CHANNELS.map((ch) => (
                        <ChannelIcon key={ch} channel={ch} label="" size="sm" />
                      ))}
                    </div>
                  )}
                  {key === "customers" && (
                    <ul aria-hidden className="mt-6 space-y-2">
                      {t.landing.pipeline.deals.slice(0, 4).map((d, i) => (
                        <li key={d.c} className="flex items-center gap-3 rounded-xl border border-border bg-surface/80 px-3 py-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-brand-violet text-[11px] font-bold text-white dark:text-bg">{d.c.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{d.c}</span>
                            <span className="block truncate text-xs text-fg-muted">{d.t}</span>
                          </span>
                          <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", ["bg-danger/10 text-danger", "bg-warning/10 text-warning", "bg-danger/10 text-danger", "bg-muted text-fg-muted"][i])}>
                            {t.score.levels[(["hot", "warm", "hot", "cold"] as const)[i]!]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Channels marquee ─────────────────────── */}
        <section aria-label={k.channels} className="border-y border-border bg-surface/60 py-6">
          <p className="mb-4 text-center text-xs font-medium uppercase tracking-widest text-fg-subtle">{k.channels}</p>
          <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
            <ul className="landing-marquee flex w-max gap-4">
              {[...CHANNELS, ...CHANNELS, ...CHANNELS, ...CHANNELS].map((ch, i) => (
                <li key={i} aria-hidden={i >= CHANNELS.length} className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium">
                  <ChannelIcon channel={ch} label="" size="sm" />
                  {t.channels.types[ch]}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── How it works ─────────────────────────── */}
        <section id="how" className="scroll-mt-20 border-y border-border bg-surface/60">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHead title={k.howTitle} />
            <ol className="relative mt-12 grid gap-6 md:grid-cols-3">
              <div aria-hidden className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block" />
              {k.how.map((step, i) => (
                <li key={step.title} className="relative rounded-2xl border border-border bg-surface p-6">
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-accent to-brand-violet text-lg font-bold text-white dark:text-bg shadow-lg shadow-accent/25">{i + 1}</span>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-fg-muted">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Industries + security ────────────────── */}
        <section className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-7">
            <h2 className="text-xl font-semibold tracking-tight">{k.industriesTitle}</h2>
            <ul className="mt-5 flex flex-wrap gap-2">
              {k.industries.map((x) => (
                <li key={x} className="rounded-full border border-border bg-bg px-3 py-1.5 text-sm">
                  {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-accent/10 via-surface to-brand-violet/10 p-7">
            <h2 className="text-xl font-semibold tracking-tight">{k.securityTitle}</h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {k.security.map((x, i) => {
                const Icon = SECURITY_ICONS[i] ?? ShieldCheck;
                return (
                  <li key={x} className="flex items-center gap-2.5 text-sm">
                    <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                    {x}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ── Pricing (the plans on sale, from the database) ── */}
        {plans.length > 0 && (
          <section id="pricing" className="scroll-mt-20 border-y border-border bg-surface/60">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
              <SectionHead title={k.pricingTitle} subtitle={`${k.pricingSubtitle} ${interpolate(k.trial, { days: trialDays })}`} />
              <ul className={clsx("mt-12 grid gap-5", plans.length >= 3 ? "lg:grid-cols-3" : "sm:grid-cols-2")}>
                {plans.map((p) => {
                  const hot = p.code === popular;
                  return (
                    <li key={p.code} className={clsx("relative flex flex-col rounded-2xl border bg-surface p-7", hot ? "border-accent shadow-2xl shadow-accent/15 lg:-translate-y-2" : "border-border")}>
                      {hot && <span className="absolute -top-3 left-7 rounded-full bg-gradient-to-r from-accent to-brand-violet px-3 py-1 text-xs font-semibold text-white dark:text-bg">{k.popular}</span>}
                      <h3 className="text-lg font-semibold">{p.name}</h3>
                      <p className="mt-3 flex items-baseline gap-1">
                        <span className="tabular text-4xl font-bold tracking-tight">{formatMoney(p.priceMonthly, locale, p.currency)}</span>
                        <span className="text-sm text-fg-muted">{k.perMonth}</span>
                      </p>
                      <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                        {[interpolate(k.seats, { n: p.seatLimit }), interpolate(k.storage, { n: Math.round(p.storageMb / 1024) }), ...(p.aiCredits ? [interpolate(k.aiCredits, { n: p.aiCredits })] : []), ...p.features.map((f) => (t.billing.features as Record<string, string>)[f] ?? f)].map((line) => (
                          <li key={line} className="flex items-start gap-2">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                            {line}
                          </li>
                        ))}
                      </ul>
                      <Link href={signedIn ? "/settings/billing" : "/signup"} className={clsx("mt-7 h-11 w-full", hot ? "btn-primary" : "btn-ghost border border-border")}>
                        {signedIn ? k.toApp : k.choose}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {/* ── FAQ ──────────────────────────────────── */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20 sm:px-6">
          <SectionHead title={k.faqTitle} />
          <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-surface">
            {k.faq.map((f) => (
              <details key={f.q} className="group px-6 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-1 font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-fg-muted transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Final call ───────────────────────────── */}
        <section className="px-4 pb-20 sm:px-6">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-accent via-brand-violet to-brand-teal p-10 text-center text-white dark:text-bg sm:p-14">
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.15)_1px,transparent_1px)] [background-size:18px_18px]" />
            <div className="relative">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{k.ctaTitle}</h2>
              <p className="mt-3 text-white/85 dark:text-bg/80">{k.ctaText}</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href={primaryHref} className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 font-semibold text-slate-900 shadow-lg hover:bg-white/90">
                  {primaryLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                {!signedIn && (
                  <Link href="/login" className="inline-flex h-11 items-center rounded-lg border border-white/40 px-5 font-semibold text-white dark:text-bg hover:bg-white/10 dark:border-bg/40">
                    {k.login}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-fg-subtle sm:px-6">
          <p>
            © {new Date().getFullYear()} {APP_NAME}. {k.footer}
          </p>
          <nav aria-label={APP_NAME} className="flex gap-4">
            <Link href="/login" className="hover:text-fg">
              {k.login}
            </Link>
            <Link href="/signup" className="hover:text-fg">
              {k.start}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 text-base text-fg-muted">{subtitle}</p>}
    </div>
  );
}
