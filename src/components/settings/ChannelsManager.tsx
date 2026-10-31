"use client";

import type { CannedResponseDto, ChannelDto, ChannelType } from "@/shared";
import { Check, Copy, ExternalLink, Lock, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { DemoBadge } from "@/components/ui/Card";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

const CONNECTABLE: ChannelType[] = ["WEBCHAT", "WHATSAPP", "TELEGRAM", "INSTAGRAM", "MESSENGER", "EMAIL"];

function widgetPreviewUrl(c: ChannelDto) {
  const key = /data-axis-widget="([^"]+)"/.exec(c.embedCode ?? "")?.[1];
  return key ? `/widget/${key}` : null;
}

export function ChannelsManager({
  channels,
  templates,
  canManage,
  canManageTemplates,
  omnichannel,
  webhookUrl,
}: {
  channels: ChannelDto[];
  templates: CannedResponseDto[];
  canManage: boolean;
  canManageTemplates: boolean;
  /** Plan includes WhatsApp / Instagram / Messenger */
  omnichannel: boolean;
  webhookUrl: string;
}) {
  const { t } = useI18n();
  const k = t.channels;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState<ChannelType | null>(null);
  const [demo, setDemo] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [simulated, setSimulated] = useState<string | null>(null);
  // Email channel: the inbound address (with its secret) is shown once, right after connecting
  const [inbound, setInbound] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; code?: string; details?: unknown }>, onOk?: () => void) =>
    startTransition(async () => {
      setError(undefined);
      const res = await fn();
      if (res.ok) onOk?.();
      else setError(errorMessage(t, res.code, res.details));
      router.refresh();
    });

  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const type = adding!;
    const body: Record<string, unknown> = { type, name: String(f.get("name")) };
    if (type === "WEBCHAT") body.greeting = String(f.get("greeting") || "") || undefined;
    else if (type === "EMAIL") {
      body.demo = demo;
      body.address = String(f.get("address"));
    } else if (type === "TELEGRAM") {
      body.demo = demo;
      if (!demo) body.botToken = String(f.get("botToken")).trim();
    } else {
      body.demo = demo;
      if (!demo) {
        body.accessToken = String(f.get("accessToken"));
        body[type === "WHATSAPP" ? "phoneNumberId" : "accountId"] = String(f.get("providerId"));
        if (type === "WHATSAPP" && String(f.get("wabaId") || "")) body.wabaId = String(f.get("wabaId"));
      }
    }
    startTransition(async () => {
      setError(undefined);
      const res = await api<ChannelDto>("/inbox/channels", "POST", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setAdding(null);
      if (res.data.inboundUrl) setInbound(res.data.inboundUrl);
      router.refresh();
    });
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch {
      /* the code is selectable */
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.title}</h1>
            <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-1.5">
              {CONNECTABLE.map((type) => {
                const locked = type !== "WEBCHAT" && !omnichannel;
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={locked}
                    title={locked ? t.billing.lockedHint : undefined}
                    onClick={() => setAdding(type)}
                    className="btn-ghost h-8 border border-border text-xs disabled:opacity-60"
                  >
                    {locked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
                    {k.types[type]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {!canManage && <p className="rounded-lg bg-muted px-3 py-2 text-xs text-fg-muted">{k.readOnly}</p>}
        {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        {adding && (
          <form onSubmit={create} className="card space-y-3 p-4" aria-label={k.add}>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ChannelIcon channel={adding} label={k.types[adding]} size="sm" />
              {k.types[adding]}
            </p>
            <label className="field-label">
              {k.name}
              <input name="name" required maxLength={80} defaultValue={k.types[adding]} className="input" />
            </label>
            {adding === "EMAIL" ? (
              <>
                <label className="field-label">
                  {k.emailAddress}
                  <input name="address" type="email" required maxLength={254} placeholder="satis@sirket.az" className="input" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
                  {k.demoMode}
                </label>
                {!demo && <p className="text-xs text-fg-subtle">{k.emailSmtpHint}</p>}
              </>
            ) : adding === "WEBCHAT" ? (
              <label className="field-label">
                {k.greeting}
                <input name="greeting" maxLength={300} placeholder={t.widget.typingHint} className="input" />
              </label>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
                  {k.demoMode}
                </label>
                {!demo && adding === "TELEGRAM" && (
                  <>
                    <label className="field-label">
                      {k.botToken}
                      <input name="botToken" required type="password" autoComplete="off" pattern="\d{5,15}:[\w-]{30,60}" aria-describedby="bot-token-hint" className="input font-mono" />
                    </label>
                    <p id="bot-token-hint" className="text-xs text-fg-subtle">
                      {k.telegramHint}
                    </p>
                  </>
                )}
                {!demo && adding !== "TELEGRAM" && (
                  <>
                    <label className="field-label">
                      {adding === "WHATSAPP" ? k.phoneNumberId : k.accountId}
                      <input name="providerId" required inputMode="numeric" pattern="\d{5,30}" className="input font-mono" />
                    </label>
                    <label className="field-label">
                      {k.accessToken}
                      <input name="accessToken" required type="password" autoComplete="off" minLength={20} className="input font-mono" />
                    </label>
                    {adding === "WHATSAPP" && (
                      <label className="field-label">
                        {k.wabaId}
                        <input name="wabaId" inputMode="numeric" pattern="\d{5,30}" aria-describedby="waba-hint" className="input font-mono" />
                        <span id="waba-hint" className="mt-1 block text-[11px] font-normal text-fg-subtle">
                          {k.wabaHint}
                        </span>
                      </label>
                    )}
                    <p className="text-xs text-fg-subtle">{k.metaHint}</p>
                    <p className="text-xs text-fg-subtle">{interpolate(k.webhookHint, { url: webhookUrl })}</p>
                  </>
                )}
              </>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className="btn-primary">
                {k.create}
              </button>
              <button type="button" onClick={() => setAdding(null)} className="btn-ghost">
                {t.crm.cancel}
              </button>
            </div>
          </form>
        )}

        {inbound && (
          <div className="card space-y-2 border-accent/40 p-4" role="status">
            <p className="text-sm font-semibold">{k.emailInboundTitle}</p>
            <p className="text-xs text-fg-muted">{k.emailInboundHint}</p>
            <div className="flex gap-2">
              <input readOnly value={inbound} aria-label={k.emailInboundTitle} className="input mt-0 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" onClick={() => void copy(inbound, "inbound")} className="btn-ghost h-9 shrink-0 border border-border text-xs">
                {copied === "inbound" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <button type="button" onClick={() => setInbound(null)} className="btn-ghost h-9 shrink-0 text-xs">
                OK
              </button>
            </div>
          </div>
        )}

        {channels.length === 0 && !adding ? (
          <p className="card px-4 py-8 text-center text-sm text-fg-muted">{k.none}</p>
        ) : (
          <ul className="space-y-3">
            {channels.map((c) => {
              const preview = widgetPreviewUrl(c);
              return (
                <li key={c.id} className="card p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <ChannelIcon channel={c.type} label={k.types[c.type]} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        {c.name}
                        {c.demo && <DemoBadge label={k.demoBadge} />}
                      </p>
                      <p className="truncate text-xs text-fg-subtle">
                        {k.types[c.type]}
                        {!c.demo && c.type !== "WEBCHAT" && ` · ${c.type === "TELEGRAM" && c.botUsername ? `@${c.botUsername}` : c.externalId}`}
                        {c.type === "WHATSAPP" && interpolate(k.templatesCount, { n: c.templates ?? 0 })}
                      </p>
                    </div>
                    {preview && (
                      <a href={preview} target="_blank" rel="noreferrer" className="btn-ghost h-8 text-xs">
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        {k.preview}
                      </a>
                    )}
                    {canManage && c.canSyncTemplates && (
                      <button type="button" disabled={pending} onClick={() => run(() => api(`/inbox/channels/${c.id}/templates/sync`, "POST"))} className="btn-ghost h-8 border border-border text-xs">
                        {k.syncTemplates}
                      </button>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => window.confirm(interpolate(k.confirmDisconnect, { name: c.name })) && run(() => api(`/inbox/channels/${c.id}`, "DELETE"))}
                        className="btn-danger h-8 text-xs"
                      >
                        {k.disconnect}
                      </button>
                    )}
                  </div>
                  {c.embedCode && (
                    <div className="mt-3">
                      <p className="text-xs text-fg-muted">{k.embed}</p>
                      <div className="mt-1 flex gap-2">
                        <input readOnly value={c.embedCode} onFocus={(e) => e.currentTarget.select()} aria-label={k.embed} className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-muted/50 px-2 font-mono text-[11px]" />
                        <button type="button" onClick={() => copy(c.embedCode!, c.id)} className="btn-ghost h-8 border border-border text-xs">
                          {copied === c.id ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                          {copied === c.id ? k.copied : k.copy}
                        </button>
                      </div>
                    </div>
                  )}
                  {c.demo && canManage && (
                    <form
                      className="mt-3 grid gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]"
                      aria-label={k.simulate}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const f = new FormData(form);
                        run(
                          () => api(`/inbox/channels/${c.id}/simulate`, "POST", { from: String(f.get("from")), body: String(f.get("body")) }),
                          () => {
                            form.reset();
                            setSimulated(c.id);
                          },
                        );
                      }}
                    >
                      <input name="from" required maxLength={80} placeholder={k.simulateFrom} aria-label={k.simulateFrom} className="input mt-0" />
                      <input name="body" required maxLength={4096} placeholder={k.simulateBody} aria-label={`${k.simulateBody}: ${c.name}`} className="input mt-0" />
                      <button type="submit" disabled={pending} className="btn-primary">
                        {k.simulateSend}
                      </button>
                      {simulated === c.id && <p role="status" className="text-xs text-success sm:col-span-3">{k.simulated}</p>}
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card h-fit">
        <h2 className="px-4 pt-4 text-sm font-semibold">{k.templatesTitle}</h2>
        <p className="px-4 text-xs text-fg-subtle">{k.templatesHint}</p>
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {templates.length === 0 && <li className="px-4 py-3 text-sm text-fg-muted">{t.inbox.noTemplates}</li>}
          {templates.map((x) => (
            <li key={x.id} className="flex items-start gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-accent">{x.shortcut}</p>
                <p className="text-sm">{x.body}</p>
              </div>
              {canManageTemplates && (
                <button
                  type="button"
                  onClick={() => run(() => api(`/inbox/templates/${x.id}`, "DELETE"))}
                  aria-label={`${k.deleteTemplate}: ${x.shortcut}`}
                  className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {canManageTemplates && (
          <form
            className="space-y-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              run(() => api("/inbox/templates", "POST", { shortcut: String(f.get("shortcut")), body: String(f.get("body")) }), () => form.reset());
            }}
          >
            <input name="shortcut" required placeholder="/salam" aria-label={k.shortcut} pattern="/[^\s]{1,30}" className="input mt-0 font-mono" />
            <textarea name="body" required maxLength={2000} rows={2} placeholder={k.body} aria-label={k.body} className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
            <button type="submit" disabled={pending} className="btn-primary h-8 text-xs">
              {k.addTemplate}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
