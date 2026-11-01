"use client";

import { INBOUND_KINDS, INBOUND_NEEDS_SECRET, type InboundHookDto, type InboundKind, type MemberDto } from "@/shared";
import clsx from "clsx";
import { Copy, PlugZap, Trash2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/** Secret addresses for website forms, Google Ads, shops and telephony. */
export function InboundCard({ initial, members }: { initial: InboundHookDto[]; members: MemberDto[] }) {
  const { t, locale } = useI18n();
  const k = t.integrations.inbound;
  const [hooks, setHooks] = useState(initial);
  const [kind, setKind] = useState<InboundKind>("leads");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const needsSecret = INBOUND_NEEDS_SECRET.includes(kind);

  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      setError(undefined);
      const res = await api<InboundHookDto>("/integrations/inbound", "POST", {
        kind,
        name: String(data.get("name") ?? "").trim() || k.kinds[kind],
        secret: String(data.get("secret") ?? "") || undefined,
        ownerId: String(data.get("ownerId") ?? "") || null,
        createDeal: data.get("createDeal") === "on",
      });
      if (!res.ok) return setError(errorMessage(t, res.code));
      setHooks((all) => [res.data, ...all]);
      form.reset();
    });
  };

  const patch = (h: InboundHookDto, body: object) =>
    startTransition(async () => {
      const res = await api<InboundHookDto>(`/integrations/inbound/${h.id}`, "PATCH", body);
      if (!res.ok) return setError(errorMessage(t, res.code));
      setHooks((all) => all.map((x) => (x.id === h.id ? res.data : x)));
    });

  const remove = (h: InboundHookDto) =>
    window.confirm(k.confirmRemove) &&
    startTransition(async () => {
      const res = await api<InboundHookDto[]>(`/integrations/inbound/${h.id}`, "DELETE");
      if (!res.ok) return setError(errorMessage(t, res.code));
      setHooks(res.data);
    });

  const copy = async (h: InboundHookDto) => {
    await navigator.clipboard?.writeText(h.url).catch(() => undefined);
    setCopied(h.id);
  };

  return (
    <section id="inbound" className="card space-y-4 p-5" aria-labelledby="inbound-title" aria-busy={pending}>
      <div>
        <h2 id="inbound-title" className="flex items-center gap-2 text-sm font-semibold">
          <PlugZap className="h-4 w-4 text-accent" aria-hidden />
          {k.title}
        </h2>
        <p className="mt-0.5 max-w-2xl text-xs text-fg-muted">{k.subtitle}</p>
      </div>

      <form onSubmit={add} className="space-y-3 rounded-xl border border-border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-xs font-medium text-fg-muted">{k.kind}</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as InboundKind)} className="input mt-1">
              {INBOUND_KINDS.map((x) => (
                <option key={x} value={x}>
                  {k.kinds[x]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-fg-muted">{k.name}</span>
            <input name="name" maxLength={80} placeholder={k.kinds[kind]} className="input mt-1" />
          </label>
          {needsSecret && (
            <label className="block text-sm">
              <span className="text-xs font-medium text-fg-muted">{k.secret}</span>
              <input name="secret" required maxLength={200} placeholder={k.secretHint[kind as keyof typeof k.secretHint]} className="input mt-1" />
            </label>
          )}
          <label className="block text-sm">
            <span className="text-xs font-medium text-fg-muted">{k.owner}</span>
            <select name="ownerId" defaultValue="" className="input mt-1">
              <option value="">{k.ownerDefault}</option>
              {members
                .filter((m) => m.status === "ACTIVE")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {(kind === "leads" || kind === "google_ads") && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="createDeal" className="h-4 w-4" />
            {k.createDeal}
          </label>
        )}
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-fg-muted">{k.help[kind]}</p>
        <button type="submit" disabled={pending} className="btn-primary">
          {k.add}
        </button>
      </form>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {hooks.length === 0 ? (
        <p className="text-sm text-fg-muted">{k.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {hooks.map((h) => (
            <li key={h.id} className="space-y-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 font-medium">
                  {h.name} <span className="text-xs font-normal text-fg-subtle">· {k.kinds[h.kind]}</span>
                </p>
                {!h.active && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-fg-muted">{k.paused}</span>}
                <button type="button" onClick={() => patch(h, { active: !h.active })} className="btn-ghost h-8 px-2 text-xs">
                  {h.active ? k.pause : k.resume}
                </button>
                <button type="button" onClick={() => remove(h)} aria-label={`${k.remove}: ${h.name}`} className="grid h-8 w-8 place-items-center rounded-md text-danger hover:bg-danger/10">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className={clsx("min-w-0 flex-1 break-all rounded-lg bg-muted px-3 py-1.5 text-xs", !h.active && "opacity-60")} aria-label={k.address}>
                  {h.url}
                </code>
                <button type="button" onClick={() => copy(h)} className="btn-ghost h-8 border border-border text-xs">
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  {copied === h.id ? k.copied : k.copy}
                </button>
              </div>
              <p className="text-xs text-fg-muted">
                {interpolate(k.received, { n: h.received })}
                {h.lastReceivedAt && ` · ${interpolate(k.last, { date: formatDateTime(h.lastReceivedAt, locale) })}`}
              </p>
              {h.lastError && <p className="text-xs text-danger">{interpolate(k.error, { error: h.lastError })}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
