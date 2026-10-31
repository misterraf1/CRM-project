"use client";

import { CONTACT_SOURCES, type FieldDefinitionDto, type MemberDto } from "@/shared";
import clsx from "clsx";
import { CalendarDays, ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/client";

export interface ContactFilterValues {
  q?: string;
  source?: string;
  ownerId?: string;
  tag?: string;
  from?: string;
  to?: string;
  type?: string;
  level?: string;
  activity?: string;
  field?: string;
  value?: string;
}

/**
 * The list's filters as a plain GET form (the URL keeps them, so they survive reloads
 * and can be shared). Dropdowns and dates apply at once; text applies on Enter.
 */
export function ContactFilters({
  values,
  keep,
  members,
  fields,
  resetHref,
}: {
  values: ContactFilterValues;
  /** View state carried along (stage tab, view, page size, sort) */
  keep: Record<string, string | undefined>;
  /** Owners to filter by; null when the member may only see their own */
  members: MemberDto[] | null;
  fields: FieldDefinitionDto[];
  resetHref: string | null;
}) {
  const { t } = useI18n();
  const c = t.crm;
  const k = t.contactList;
  const form = useRef<HTMLFormElement>(null);
  const advancedCount = [values.type, values.level, values.activity, values.field && values.value].filter(Boolean).length;
  const [more, setMore] = useState(advancedCount > 0 || !!values.field);
  const apply = () => form.current?.requestSubmit();
  const box = "h-10 rounded-xl border border-border bg-surface text-sm outline-none transition-colors hover:border-fg-subtle/40 focus:border-accent";

  // `auto`: apply on change; a custom field waits for its value
  const select = (name: keyof ContactFilterValues, label: string, options: [string, string][], wide = false, auto = true): ReactNode => (
    <label className={clsx("relative", wide && "min-w-40")}>
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={values[name] ?? ""} aria-label={label} onChange={auto ? apply : undefined} className={clsx(box, "w-full appearance-none pl-3 pr-8 font-medium")}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-fg-subtle" aria-hidden />
    </label>
  );

  return (
    <form ref={form} action="/crm" className="space-y-2.5">
      {Object.entries(keep).map(([name, v]) => v && <input key={name} type="hidden" name={name} value={v} />)}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-52 flex-1">
          <span className="sr-only">{c.search}</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-fg-subtle" aria-hidden />
          <input name="q" defaultValue={values.q} placeholder={c.search} className={clsx(box, "w-full pl-9 pr-3")} />
        </label>
        {select("source", c.source, [["", c.sourceAll], ...CONTACT_SOURCES.map((x): [string, string] => [x, c.sources[x]])])}
        {members &&
          select("ownerId", c.owner, [
            ["", c.ownerAll],
            ["none", c.ownerNone],
            ...members.filter((m) => m.status === "ACTIVE").map((m): [string, string] => [m.id, m.fullName]),
          ])}
        <input name="tag" defaultValue={values.tag} placeholder={c.tag} aria-label={c.tag} maxLength={40} className={clsx(box, "w-28 px-3")} />
        <fieldset className={clsx(box, "flex items-center gap-1.5 px-3")}>
          <legend className="sr-only">{k.createdRange}</legend>
          <CalendarDays className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
          <input type="date" name="from" defaultValue={values.from} aria-label={k.from} onChange={apply} className="w-[7.5rem] bg-transparent text-sm outline-none" />
          <span className="text-fg-subtle" aria-hidden>
            –
          </span>
          <input type="date" name="to" defaultValue={values.to} aria-label={k.to} onChange={apply} className="w-[7.5rem] bg-transparent text-sm outline-none" />
        </fieldset>
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          aria-controls="contact-more-filters"
          className={clsx(box, "inline-flex items-center gap-2 px-3.5 font-medium", more || advancedCount ? "border-accent/40 text-accent" : "text-fg")}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          {k.filters}
          {advancedCount > 0 && <span className="tabular rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-5 text-accent-fg">{advancedCount}</span>}
        </button>
        <button type="submit" aria-label={c.search} title={c.search} className={clsx(box, "grid w-10 place-items-center")}>
          <Search className="h-4 w-4" aria-hidden />
        </button>
        {resetHref && (
          <Link href={resetHref} className="px-1 text-sm font-medium text-accent hover:underline">
            {c.resetFilters}
          </Link>
        )}
      </div>

      <div id="contact-more-filters" hidden={!more} className={clsx(more ? "flex" : "hidden", "flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-2.5")}>
        {select("type", c.type, [["", c.all], ["person", c.typePeople], ["company", c.typeCompanies]])}
        {select("level", t.score.filterLevel, [["", t.score.anyLevel], ...(["hot", "warm", "cold"] as const).map((x): [string, string] => [x, t.score.levels[x]])])}
        {select("activity", t.score.activity, [["", t.score.anyActivity], ["active", t.score.activeOnly], ["passive", t.score.passiveOnly]])}
        {fields.length > 0 && (
          <>
            {select("field", c.fieldFilter, [["", c.fieldFilter], ...fields.map((f): [string, string] => [f.id, f.label])], true, false)}
            <input name="value" defaultValue={values.value} placeholder={c.fieldValue} aria-label={c.fieldValue} maxLength={200} className={clsx(box, "w-36 px-3")} />
          </>
        )}
      </div>
    </form>
  );
}
