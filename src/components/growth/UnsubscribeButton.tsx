"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { useHydrated } from "@/lib/use-hydrated";

/** A deliberate click (mail scanners open links, they don't press buttons). */
export function UnsubscribeButton({ token }: { token: string }) {
  const { t } = useI18n();
  const k = t.unsubscribe;
  const hydrated = useHydrated();
  const [state, setState] = useState<"idle" | "done" | "invalid">("idle");
  if (state !== "idle") return <p role="status" className={state === "done" ? "text-sm text-success" : "text-sm text-danger"}>{state === "done" ? k.done : k.invalid}</p>;
  return (
    <button
      type="button"
      disabled={!hydrated}
      onClick={async () => {
        const res = await fetch(`/api/v1/public/unsubscribe/${encodeURIComponent(token)}`, { method: "POST" });
        setState(res.ok ? "done" : "invalid");
      }}
      className="btn-primary"
    >
      {k.button}
    </button>
  );
}
