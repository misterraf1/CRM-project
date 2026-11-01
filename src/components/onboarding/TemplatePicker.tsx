"use client";

import type { BusinessTemplateKey, TemplatePreviewDto, TemplateResultDto } from "@/shared";
import clsx from "clsx";
import {
  ArrowLeft,
  Building2,
  Car,
  CheckCircle2,
  Factory,
  GraduationCap,
  HardHat,
  Megaphone,
  Plane,
  Scale,
  Scissors,
  Server,
  ShoppingBag,
  Stethoscope,
  Truck,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

const ICONS: Record<BusinessTemplateKey, LucideIcon> = {
  retail: ShoppingBag,
  services: Wrench,
  clinic: Stethoscope,
  beauty: Scissors,
  realestate: Building2,
  education: GraduationCap,
  travel: Plane,
  auto: Car,
  construction: HardHat,
  production: Factory,
  logistics: Truck,
  restaurant: UtensilsCrossed,
  legal: Scale,
  agency: Megaphone,
  hosting: Server,
};

/**
 * Line-of-business set-ups: pick one, see exactly what it brings, then apply.
 * `setup` is the first-run choice — it also sets the menu and the trade's words;
 * otherwise a template only adds a pipeline, fields and products.
 */
export function TemplatePicker({ applied: initial, previews, setup = false }: { applied: BusinessTemplateKey[]; previews: TemplatePreviewDto[]; setup?: boolean }) {
  const { t } = useI18n();
  const k = t.templates;
  const router = useRouter();
  const [applied, setApplied] = useState(initial);
  const [selected, setSelected] = useState<BusinessTemplateKey | null>(null);
  const [makeDefault, setMakeDefault] = useState(setup);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const preview = previews.find((p) => p.key === selected);

  const apply = (key: BusinessTemplateKey) =>
    startTransition(async () => {
      setError(undefined);
      const res = await api<TemplateResultDto>("/onboarding/template", "POST", { key, makeDefault, setup });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setApplied((a) => [...a, key]);
      setSelected(null);
      setNote(setup ? interpolate(k.setupDone, { name: k.items[key].name }) : interpolate(k.done, { fields: res.data.fields, products: res.data.products, automations: res.data.automations }));
      router.refresh();
    });

  const list = (label: string, values: string[]) =>
    values.length > 0 && (
      <div>
        <p className="text-xs font-medium text-fg-muted">{label}</p>
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <li key={v} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
              {v}
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <section id="templates" className="card space-y-4 p-5" aria-labelledby="templates-title" aria-busy={pending}>
      <div>
        <h2 id="templates-title" className={clsx("font-semibold", setup ? "text-lg" : "text-sm")}>
          {setup ? k.pickTitle : k.title}
        </h2>
        <p className="mt-0.5 text-sm text-fg-muted">{setup ? k.pickSubtitle : k.subtitle}</p>
      </div>

      {preview ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
              {(() => {
                const Icon = ICONS[preview.key];
                return <Icon className="h-5 w-5" aria-hidden />;
              })()}
            </span>
            <div>
              <p className="font-semibold">{k.items[preview.key].name}</p>
              <p className="text-sm text-fg-muted">{k.items[preview.key].desc}</p>
            </div>
          </div>
          <div className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
            <p className="text-sm font-semibold sm:col-span-2">{k.preview}</p>
            {list(k.stagesLabel, preview.stages)}
            {list(k.fieldsLabel, preview.fields)}
            {list(k.productsLabel, preview.products)}
            {list(k.stepsLabel, preview.orderSteps)}
            {setup && (
              <>
                <div>
                  <p className="text-xs font-medium text-fg-muted">{k.hiddenLabel}</p>
                  <p className="mt-1 text-sm">{preview.hide.length ? preview.hide.map((m) => t.nav[m]).join(", ") : k.noneHidden}</p>
                </div>
                {list(k.wordsLabel, [preview.terms.contacts, preview.terms.deals, preview.terms.orders].filter((w): w is string => !!w))}
              </>
            )}
          </div>
          {!setup && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
              {k.makeDefault}
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => apply(preview.key)} className="btn-primary">
              {setup ? k.setup : k.apply}
            </button>
            <button type="button" onClick={() => setSelected(null)} className="btn-ghost border border-border">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {k.back}
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className={clsx("grid grid-cols-2 gap-2 sm:grid-cols-3", setup && "lg:grid-cols-5")}>
            {previews.map(({ key }) => {
              const Icon = ICONS[key];
              const done = applied.includes(key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setSelected(key)}
                    className="flex h-full min-h-24 w-full flex-col items-start gap-2 rounded-xl border border-border p-3 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/40"
                  >
                    <span className="flex w-full items-center justify-between">
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent">
                        <Icon className="h-[18px] w-[18px]" aria-hidden />
                      </span>
                      {done && (
                        <span className="text-success">
                          <CheckCircle2 className="h-4 w-4" aria-hidden />
                          <span className="sr-only">{k.applied}</span>
                        </span>
                      )}
                    </span>
                    <span className="text-sm font-medium leading-tight">{k.items[key].name}</span>
                    <span className="line-clamp-2 text-xs text-fg-muted">{k.items[key].desc}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {setup && <p className="text-xs text-fg-muted">{k.otherHint}</p>}
        </>
      )}
      {note && <p role="status" className="text-sm text-success">{note}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}
