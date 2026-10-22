"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

/** Confirms, deletes through the API, then navigates to `redirectTo`. */
export function DeleteButton({ path, confirmText, label, redirectTo }: { path: string; confirmText: string; label: string; redirectTo: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          window.confirm(confirmText) &&
          startTransition(async () => {
            const res = await api(path, "DELETE");
            if (!res.ok) return setError(errorMessage(t, res.code));
            router.push(redirectTo);
            router.refresh();
          })
        }
        className="btn-danger h-8 text-xs"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        {label}
      </button>
    </span>
  );
}
