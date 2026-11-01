"use client";

import { HIDEABLE_MODULES, TERM_KEYS, type HideableModule, type TermKey, type TermLang, type WorkspaceDto } from "@/shared";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { LOCALE_LABELS, LOCALES } from "@/lib/i18n/locales";

/** Which sections the menu shows and the company's own words, per language. */
export function WorkspaceForm({ initial, defaults }: { initial: WorkspaceDto; defaults: Record<TermLang, Record<TermKey, string>> }) {
  const { t, locale } = useI18n();
  const k = t.workspace;
  const router = useRouter();
  const [hidden, setHidden] = useState<HideableModule[]>(initial.hiddenModules);
  const [terms, setTerms] = useState(initial.terms);
  const [lang, setLang] = useState<TermLang>(locale);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();
  const [pending, startTransition] = useTransition();

  const toggle = (m: HideableModule) => setHidden((h) => (h.includes(m) ? h.filter((x) => x !== m) : [...h, m]));
  const setTerm = (key: TermKey, value: string) => setTerms((all) => ({ ...all, [lang]: { ...all[lang], [key]: value } }));

  const save = () =>
    startTransition(async () => {
      setStatus(undefined);
      const res = await api<WorkspaceDto>("/settings/workspace", "PATCH", { hiddenModules: hidden, terms });
      if (!res.ok) return setStatus({ ok: false, text: errorMessage(t, res.code, res.details) ?? t.errors.INTERNAL });
      setTerms(res.data.terms);
      setStatus({ ok: true, text: k.saved });
      router.refresh();
    });

  return (
    <div className="space-y-5" aria-busy={pending}>
      <section className="card space-y-3 p-5" aria-labelledby="ws-modules">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="ws-modules" className="text-sm font-semibold">
              {k.modulesTitle}
            </h2>
            <p className="mt-0.5 text-xs text-fg-muted">{k.modulesHint}</p>
          </div>
          {hidden.length > 0 && (
            <button type="button" onClick={() => setHidden([])} className="btn-ghost h-8 border border-border text-xs">
              {k.showAll}
            </button>
          )}
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {HIDEABLE_MODULES.map((m) => (
            <li key={m}>
              <label className={clsx("flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm", hidden.includes(m) ? "border-border text-fg-muted" : "border-accent/40 bg-accent-soft/30")}>
                <input type="checkbox" checked={!hidden.includes(m)} onChange={() => toggle(m)} className="h-4 w-4" />
                {t.nav[m]}
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3 p-5" aria-labelledby="ws-terms">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="ws-terms" className="text-sm font-semibold">
              {k.termsTitle}
            </h2>
            <p className="mt-0.5 text-xs text-fg-muted">{k.termsHint}</p>
          </div>
          <div role="group" aria-label={k.language} className="flex rounded-lg border border-border p-0.5">
            {LOCALES.map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", lang === l ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-muted")}>
                {LOCALE_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TERM_KEYS.map((key) => (
            <label key={key} className="block text-sm">
              <span className="text-xs font-medium text-fg-muted">{k.keys[key]}</span>
              <input value={terms[lang]?.[key] ?? ""} onChange={(e) => setTerm(key, e.target.value)} placeholder={defaults[lang][key]} maxLength={40} className="input mt-1" />
            </label>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={pending} className="btn-primary">
          {k.save}
        </button>
        <Link href="/settings/crm#templates" className="text-sm font-medium text-accent hover:underline">
          {k.templateLink}
        </Link>
        {status && (
          <p role={status.ok ? "status" : "alert"} className={clsx("text-sm", status.ok ? "text-success" : "text-danger")}>
            {status.text}
          </p>
        )}
      </div>
    </div>
  );
}
