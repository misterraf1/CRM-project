"use client";

import type { DealDto, PipelineDto } from "@axis/shared";
import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { formatMoney, parseMoneyInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

export function ContactDeals({ contactId, deals, pipeline }: { contactId: string; deals: DealDto[]; pipeline: PipelineDto }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const stageById = new Map(pipeline.stages.map((s) => [s.id, s]));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = parseMoneyInput(String(f.get("amount") || "0"));
    if (amount === null) return setError(t.errors.VALIDATION_FAILED);
    startTransition(async () => {
      const res = await api("/deals", "POST", { title: String(f.get("title")), amount, contactId });
      if (!res.ok) return setError(errorMessage(t, res.code));
      setOpen(false);
      setError(undefined);
      router.refresh();
    });
  }

  return (
    <section className="card">
      <header className="flex items-center justify-between px-5 pt-4">
        <h2 className="text-sm font-semibold">{t.crm.deals}</h2>
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t.crm.addDeal}
        </button>
      </header>
      {open && (
        <form onSubmit={submit} className="mx-5 mt-3 grid gap-2 rounded-lg bg-muted/50 p-3 sm:grid-cols-[1fr_120px_auto]">
          <input name="title" required maxLength={150} placeholder={t.deals.dealTitle} aria-label={t.deals.dealTitle} className="input mt-0" autoFocus />
          <input name="amount" inputMode="decimal" placeholder="0" aria-label={t.deals.amount} className="input mt-0" />
          <button type="submit" disabled={pending} className="btn-primary">
            {t.deals.create}
          </button>
          {error && <p className="text-xs text-danger sm:col-span-3">{error}</p>}
        </form>
      )}
      {deals.length === 0 ? (
        <p className="px-5 py-5 text-sm text-fg-muted">{t.crm.noDeals}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {deals.map((d) => {
            const stage = stageById.get(d.stageId);
            return (
              <li key={d.id}>
                <Link href={`/deals/${d.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-muted/50">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{d.title}</span>
                    <span
                      className={clsx(
                        "text-xs",
                        stage?.kind === "won" ? "text-success" : stage?.kind === "lost" ? "text-danger" : "text-fg-subtle",
                      )}
                    >
                      {stage?.name}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-medium">{formatMoney(d.amount, locale, d.currency)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
