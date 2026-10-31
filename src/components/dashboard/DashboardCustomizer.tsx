"use client";

import { SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DASHBOARD_COOKIE, type DashboardWidget } from "@/lib/dashboard";
import { useI18n } from "@/lib/i18n/client";


/** Each member picks what their dashboard shows. */
export function DashboardCustomizer({ hidden: initial, available }: { hidden: DashboardWidget[]; available: DashboardWidget[] }) {
  const { t } = useI18n();
  const k = t.dashboard.customize;
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(new Set(initial));
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  const save = (next: Set<DashboardWidget>) => {
    setHidden(next);
    document.cookie = `${DASHBOARD_COOKIE}=${[...next].join(".")}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost h-9 border border-border bg-surface">
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">{k.button}</span>
        <span className="sr-only sm:hidden">{k.button}</span>
      </button>
      <dialog ref={ref} onClose={() => setOpen(false)} aria-labelledby="dash-customize" className="w-[min(92vw,420px)] rounded-2xl border border-border bg-surface p-0 text-fg backdrop:bg-black/40">
        <div className="p-5">
          <h2 id="dash-customize" className="text-base font-semibold">
            {k.title}
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">{k.hint}</p>
          <ul className="mt-4 grid gap-1">
            {available.map((w) => (
              <li key={w}>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted">
                  {k.widgets[w]}
                  <input
                    type="checkbox"
                    role="switch"
                    checked={!hidden.has(w)}
                    onChange={(e) => {
                      const next = new Set(hidden);
                      if (e.target.checked) next.delete(w);
                      else next.add(w);
                      save(next);
                    }}
                    className="h-4 w-4 accent-[rgb(var(--accent))]"
                  />
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-between gap-2">
            <button type="button" onClick={() => save(new Set())} className="btn-ghost">
              {k.reset}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-primary">
              {k.done}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
