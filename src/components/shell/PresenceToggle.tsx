"use client";

import clsx from "clsx";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";

/** Operator status: "away" members are skipped when conversations and leads are assigned automatically. */
export function PresenceToggle({ initial }: { initial: "available" | "away" }) {
  const { t } = useI18n();
  const k = t.shell.presence;
  const [presence, setPresence] = useState(initial);
  const [pending, startTransition] = useTransition();
  const away = presence === "away";

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={away}
      title={k.hint}
      onClick={() => {
        const next = away ? "available" : "away";
        setPresence(next);
        startTransition(async () => {
          const res = await api("/members/me/presence", "PATCH", { presence: next });
          if (!res.ok) setPresence(presence);
        });
      }}
      className="mt-0.5 inline-flex items-center gap-1 rounded text-[11px] text-nav-muted hover:text-white"
    >
      <span className={clsx("h-2 w-2 rounded-full", away ? "bg-warning" : "bg-success")} aria-hidden />
      {away ? k.away : k.available}
    </button>
  );
}
