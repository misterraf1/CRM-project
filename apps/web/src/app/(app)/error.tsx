"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/client";

/** Shown instead of a blank crash when a page's data can't be loaded (API down, rate limit, etc.). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md py-16 text-center" role="alert">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-warning/10 text-warning">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-semibold">{t.common.errorTitle}</h1>
      <p className="mt-2 text-sm text-fg-muted">{t.common.errorBody}</p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-fg-subtle">{error.digest}</p>}
      <button type="button" onClick={reset} className="btn-primary mt-6">
        <RotateCcw className="h-4 w-4" aria-hidden />
        {t.common.retry}
      </button>
    </div>
  );
}
