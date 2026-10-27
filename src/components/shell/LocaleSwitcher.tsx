"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "@/lib/i18n/actions";
import { useI18n } from "@/lib/i18n/client";
import { LOCALE_LABELS, LOCALES } from "@/lib/i18n/locales";

export function LocaleSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div role="group" aria-label={t.shell.language} className={clsx("flex rounded-lg bg-muted p-0.5", pending && "opacity-60")}>
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={code === locale}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await setLocale(code);
              router.refresh();
            })
          }
          className={clsx(
            "rounded-md px-2 py-1 text-[11px] font-semibold",
            code === locale ? "bg-surface text-fg shadow-sm" : "text-fg-subtle hover:text-fg",
          )}
        >
          {LOCALE_LABELS[code]}
        </button>
      ))}
    </div>
  );
}
