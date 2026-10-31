"use client";

import clsx from "clsx";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";

/** Before/after for the owner: one switch flips every pain into what Axis does about it. */
export function OwnerSwitch() {
  const { t } = useI18n();
  const k = t.landing.owner;
  const [after, setAfter] = useState(true);
  return (
    <div>
      <div className="flex justify-center">
        <div role="radiogroup" aria-label={k.title} className="inline-flex rounded-full border border-border bg-surface p-1 shadow-sm">
          {[false, true].map((v) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={after === v}
              onClick={() => setAfter(v)}
              className={clsx(
                "w-40 rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-300 sm:w-48",
                after !== v ? "text-fg-muted hover:text-fg" : v ? "bg-accent text-accent-fg" : "bg-danger text-white dark:text-bg",
              )}
            >
              {v ? k.after : k.before}
            </button>
          ))}
        </div>
      </div>
      <ul className="mt-10 grid gap-4 md:grid-cols-2">
        {k.rows.map((row, i) => (
          <li
            key={i}
            className={clsx(
              "flex items-start gap-3 rounded-2xl border p-5 transition-all duration-300",
              after ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5",
            )}
            style={{ transitionDelay: `${i * 40}ms` }}
          >
            <span className={clsx("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", after ? "bg-success text-white dark:text-bg" : "bg-danger text-white dark:text-bg")}>
              {after ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
            </span>
            <p key={String(after)} className="animate-[landing-rise_0.35s_ease-out_both] text-sm leading-relaxed sm:text-base">
              {after ? row.a : row.b}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
