"use client";

import type { ContactDto, DealDto, MemberDto, PipelineDto } from "@axis/shared";
import { LOST_REASONS } from "@axis/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { moneyInputValue, parseMoneyInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

interface Props {
  deal: DealDto;
  pipeline: PipelineDto;
  contacts: ContactDto[];
  members: MemberDto[];
  canAssign: boolean;
}

export function DealEditor({ deal, pipeline, contacts, members, canAssign }: Props) {
  const { t } = useI18n();
  const d = t.deals;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [stageId, setStageId] = useState(deal.stageId);
  const [reason, setReason] = useState(deal.lostReason ?? LOST_REASONS[0]);
  const target = pipeline.stages.find((s) => s.id === stageId)!;
  // The linked contact may be outside the first page of contacts; keep it selectable
  const contactOptions = deal.contact && !contacts.some((c) => c.id === deal.contact!.id) ? [deal.contact, ...contacts] : contacts;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = parseMoneyInput(String(f.get("amount") || "0"));
    if (amount === null) return setError(t.errors.VALIDATION_FAILED);
    const close = String(f.get("expectedClose") || "");
    const fields: Record<string, unknown> = {
      title: String(f.get("title")),
      amount,
      contactId: String(f.get("contactId")) || null,
      expectedClose: close ? new Date(`${close}T12:00:00`).toISOString() : null,
    };
    if (canAssign) fields.ownerId = String(f.get("ownerId")) || null;

    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const res = await api<DealDto>(`/deals/${deal.id}`, "PATCH", fields);
      if (!res.ok) return setError(errorMessage(t, res.code));
      if (stageId !== deal.stageId || (target.kind === "lost" && reason !== deal.lostReason)) {
        const moved = await api(`/deals/${deal.id}/move`, "POST", { stageId, lostReason: target.kind === "lost" ? reason : undefined });
        if (!moved.ok) return setError(errorMessage(t, moved.code));
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field-label sm:col-span-2">
          {d.dealTitle}
          <input name="title" required maxLength={150} defaultValue={deal.title} className="input" />
        </label>
        <label className="field-label">
          {d.amount}
          <input name="amount" inputMode="decimal" defaultValue={moneyInputValue(deal.amount)} className="input" />
        </label>
        <label className="field-label">
          {d.expectedClose}
          <input name="expectedClose" type="date" defaultValue={deal.expectedClose?.slice(0, 10) ?? ""} className="input" />
        </label>
        <label className="field-label">
          {d.stage}
          <select value={stageId} onChange={(e) => setStageId(e.target.value)} className="input">
            {pipeline.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {target.kind === "lost" ? (
          <label className="field-label">
            {d.lostTitle}
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="input">
              {LOST_REASONS.map((r) => (
                <option key={r} value={r}>
                  {d.reasons[r]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="hidden sm:block" />
        )}
        <label className="field-label">
          {d.contact}
          <select name="contactId" defaultValue={deal.contact?.id ?? ""} className="input">
            <option value="">{d.noContact}</option>
            {contactOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {canAssign && (
          <label className="field-label">
            {d.owner}
            <select name="ownerId" defaultValue={deal.owner?.id ?? ""} className="input">
              <option value="">{t.crm.unassigned}</option>
              {members
                .filter((m) => m.status === "ACTIVE")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {d.save}
        </button>
        {saved && (
          <span role="status" className="text-sm text-success">
            {d.saved}
          </span>
        )}
      </div>
    </form>
  );
}
