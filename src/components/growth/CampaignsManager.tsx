"use client";

import { CONTACT_SOURCES, LIFECYCLE_STAGES, type CampaignDto, type CampaignInput, type CampaignPreviewDto, type MemberDto, type Segment } from "@/shared";
import clsx from "clsx";
import { AlertTriangle, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

type Draft = CampaignInput & { id?: string };

/** Campaigns: write, pick the segment (live recipient count), send once, then results. */
export function CampaignsManager({ campaigns: initial, members, currency }: { campaigns: CampaignDto[]; members: MemberDto[]; currency: string }) {
  const { t, locale } = useI18n();
  const k = t.campaigns;
  const [campaigns, setCampaigns] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<CampaignPreviewDto | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Recipient count follows the segment while editing
  const segmentKey = JSON.stringify(draft?.segment ?? null);
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => void api<CampaignPreviewDto>("/campaigns/preview", "POST", draft.segment).then((r) => r.ok && setPreview(r.data)), 250);
    return () => clearTimeout(timer);
    // The segment is what matters, not the rest of the draft
  }, [segmentKey]);

  const setSegment = (patch: Partial<Segment>) => {
    if (!draft) return;
    const next = { ...draft.segment, ...patch } as Record<string, unknown>;
    for (const key of Object.keys(next)) if (!next[key]) delete next[key];
    setDraft({ ...draft, segment: next as Segment });
  };

  const upsert = (c: CampaignDto) => setCampaigns((all) => (all.some((x) => x.id === c.id) ? all.map((x) => (x.id === c.id ? c : x)) : [c, ...all]));

  function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const { id, ...body } = draft;
    startTransition(async () => {
      setError(undefined);
      const res = id ? await api<CampaignDto>(`/campaigns/${id}`, "PATCH", body) : await api<CampaignDto>("/campaigns", "POST", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      upsert(res.data);
      setDraft(null);
    });
  }

  function send(c: CampaignDto) {
    startTransition(async () => {
      const p = await api<CampaignPreviewDto>("/campaigns/preview", "POST", c.segment);
      if (!p.ok) return setError(errorMessage(t, p.code, p.details));
      if (!window.confirm(interpolate(k.confirmSend, { name: c.name, n: p.data.recipients }))) return;
      const res = await api<CampaignDto>(`/campaigns/${c.id}/send`, "POST");
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      upsert(res.data);
    });
  }

  function remove(c: CampaignDto) {
    startTransition(async () => {
      const res = await api(`/campaigns/${c.id}`, "DELETE");
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setCampaigns((all) => all.filter((x) => x.id !== c.id));
    });
  }

  const s = draft?.segment ?? {};
  return (
    <div className="space-y-4" aria-busy={pending}>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {!draft && (
        <button type="button" onClick={() => (setPreview(null), setDraft({ name: "", subject: "", body: "", segment: {} }))} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden />
          {k.new}
        </button>
      )}
      {draft && (
        <form onSubmit={save} className="card space-y-4 p-5" aria-label={draft.id ? draft.name : k.new}>
          <label className="field-label">
            {k.name}
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required minLength={2} maxLength={100} className="input" />
          </label>
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-xs font-medium text-fg-muted">{k.segment}</legend>
            <select value={s.stage ?? ""} onChange={(e) => setSegment({ stage: (e.target.value || undefined) as Segment["stage"] })} aria-label={k.anyStage} className="input">
              <option value="">{k.anyStage}</option>
              {LIFECYCLE_STAGES.map((x) => (
                <option key={x} value={x}>
                  {t.crm.stages[x]}
                </option>
              ))}
            </select>
            <select value={s.source ?? ""} onChange={(e) => setSegment({ source: e.target.value || undefined })} aria-label={t.crm.source} className="input">
              <option value="">{k.anySource}</option>
              {CONTACT_SOURCES.map((x) => (
                <option key={x} value={x}>
                  {t.crm.sources[x]}
                </option>
              ))}
            </select>
            <input value={s.tag ?? ""} onChange={(e) => setSegment({ tag: e.target.value || undefined })} placeholder={k.tag} aria-label={k.tag} maxLength={40} className="input" />
            <select value={s.level ?? ""} onChange={(e) => setSegment({ level: (e.target.value || undefined) as Segment["level"] })} aria-label={t.score.filterLevel} className="input">
              <option value="">{t.score.anyLevel}</option>
              {(["hot", "warm", "cold"] as const).map((x) => (
                <option key={x} value={x}>
                  {t.score.levels[x]}
                </option>
              ))}
            </select>
            <select value={s.activity ?? ""} onChange={(e) => setSegment({ activity: (e.target.value || undefined) as Segment["activity"] })} aria-label={t.score.activity} className="input">
              <option value="">{t.score.anyActivity}</option>
              <option value="active">{t.score.activeOnly}</option>
              <option value="passive">{t.score.passiveOnly}</option>
            </select>
            <select value={s.ownerId ?? ""} onChange={(e) => setSegment({ ownerId: e.target.value || undefined })} aria-label={t.crm.owner} className="input">
              <option value="">{t.crm.owner}</option>
              {members
                .filter((m) => m.status === "ACTIVE")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
            </select>
          </fieldset>
          {preview && (
            <div className="space-y-1 text-sm" role="status">
              <p className="font-medium">{interpolate(k.preview, { n: preview.recipients })}</p>
              {preview.excluded > 0 && <p className="text-xs text-fg-muted">{interpolate(k.excluded, { n: preview.excluded })}</p>}
              {!preview.mailConfigured && (
                <p className="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  {k.noSmtp}
                </p>
              )}
            </div>
          )}
          <label className="field-label">
            {k.subject}
            <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} required minLength={2} maxLength={200} className="input" />
          </label>
          <label className="field-label">
            {k.body}
            <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required minLength={2} maxLength={20_000} rows={8} className="input" />
            <span className="mt-1 block text-[11px] font-normal text-fg-subtle">{k.bodyHint}</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary">
              {k.save}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="btn-ghost">
              {k.cancel}
            </button>
          </div>
        </form>
      )}

      {campaigns.length === 0 && !draft ? (
        <p className="card p-6 text-sm text-fg-muted">{k.empty}</p>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((c) => (
            <li key={c.id} className="card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{c.name}</p>
                  <p className="truncate text-xs text-fg-muted">
                    {c.subject}
                    {c.sentAt && ` · ${formatDateTime(c.sentAt, locale)}`}
                  </p>
                </div>
                <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", c.status === "sent" ? "bg-success/10 text-success" : "bg-muted text-fg-muted")}>{k.statuses[c.status]}</span>
                {c.status === "draft" && (
                  <span className="flex gap-1">
                    <button type="button" disabled={pending} onClick={() => send(c)} className="btn-primary h-8 text-xs">
                      <Send className="h-3.5 w-3.5" aria-hidden />
                      {k.send}
                    </button>
                    <button type="button" onClick={() => (setPreview(null), setDraft({ id: c.id, name: c.name, subject: c.subject, body: c.body, segment: c.segment }))} aria-label={`${k.edit}: ${c.name}`} className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-muted">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" disabled={pending} onClick={() => remove(c)} aria-label={`${k.delete}: ${c.name}`} className="grid h-8 w-8 place-items-center rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              {c.status === "sent" && (
                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
                  {(
                    [
                      [k.stats.recipients, c.stats.recipients],
                      [k.stats.sent, c.stats.sent],
                      [k.stats.pending, c.stats.pending],
                      [k.stats.failed, c.stats.failed],
                      [k.stats.unsubscribed, c.stats.unsubscribed],
                    ] as const
                  ).map(([label, n]) => (
                    <div key={label}>
                      <dt className="text-[11px] text-fg-muted">{label}</dt>
                      <dd className="tabular font-semibold">{n}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-[11px] text-fg-muted">{k.stats.won}</dt>
                    <dd className="tabular font-semibold">
                      {c.stats.wonDeals} · {formatMoney(c.stats.revenue, locale, currency)}
                    </dd>
                  </div>
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
