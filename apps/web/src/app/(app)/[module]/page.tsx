import { ArrowLeft, Hammer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/locales";
import { PLANNED_MODULES } from "@/lib/navigation";

// Honest placeholder for modules that are designed but not built yet.
// Each module replaces this route with its own folder as it ships.

export const dynamicParams = false;

export function generateStaticParams() {
  return PLANNED_MODULES.map((m) => ({ module: m.href.slice(1) }));
}

type Props = { params: Promise<{ module: string }> };

const findModule = (slug: string) => PLANNED_MODULES.find((m) => m.href === `/${slug}`);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t } = await getI18n();
  const mod = findModule((await params).module);
  return { title: mod ? t.nav[mod.key] : undefined };
}

export default async function PlannedModulePage({ params }: Props) {
  const mod = findModule((await params).module);
  if (!mod) notFound();
  const { t } = await getI18n();
  const copy = t.modules[mod.key];
  const phase = interpolate(t.common.phase, { n: mod.phase });

  return (
    <div className="mx-auto max-w-xl py-12 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <mod.icon className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="mt-5 text-xl font-semibold">{copy.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{copy.description}</p>
      <div className="card mt-6 flex items-start gap-3 p-4 text-left">
        <Hammer className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div>
          <p className="text-sm font-medium">{t.modules.plannedTitle}</p>
          <p className="mt-0.5 text-sm text-fg-muted">{interpolate(t.modules.plannedBody, { phase })}</p>
        </div>
      </div>
      <Link href="/dashboard" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.common.backToDashboard}
      </Link>
    </div>
  );
}
