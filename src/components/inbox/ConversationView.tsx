"use client";

import type { AiTextDto, CannedResponseDto, ConversationDetailDto, MeResponse, MessageAttachmentDto, MessageDto, WhatsAppTemplateDto } from "@/shared";
import clsx from "clsx";
import { AlertTriangle, ArrowLeft, Ban, Check, FileText, MessageSquareQuote, Paperclip, RotateCcw, Sparkles, StickyNote, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { DemoBadge } from "@/components/ui/Card";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { api } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

type Mode = "reply" | "note";

const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files in a message: a download link each (files are always served as downloads). */
function Attachments({ items, outbound, notStored }: { items: MessageAttachmentDto[]; outbound: boolean; notStored: string }) {
  if (!items.length) return null;
  return (
    <ul className="mt-1 space-y-1">
      {items.map((a, i) => (
        <li key={a.fileId ?? i}>
          {a.fileId ? (
            <a
              href={`/api/v1/files/${a.fileId}`}
              download={a.name}
              className={clsx("inline-flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs underline-offset-2 hover:underline", outbound ? "bg-white/15" : "bg-muted")}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{a.name}</span>
              <span className="shrink-0 opacity-70">{fileSize(a.sizeBytes)}</span>
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs opacity-80">
              <FileText className="h-3.5 w-3.5" aria-hidden />
              {a.name} · {notStored}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** WhatsApp outside the 24 h window: pick an approved template and fill its {{n}} values. */
function TemplateComposer({ conversationId, templates, onSent, t }: { conversationId: string; templates: WhatsAppTemplateDto[]; onSent: () => void; t: ReturnType<typeof useI18n>["t"] }) {
  const k = t.inbox;
  const [choice, setChoice] = useState(0);
  const [values, setValues] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const tpl = templates[choice];
  if (!tpl) return <p className="mb-2 text-xs text-fg-muted">{k.noWaTemplates}</p>;
  const preview = tpl.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => values[Number(n) - 1] || `{{${n}}}`);
  return (
    <div className="mb-2 rounded-lg border border-border p-3">
      <label className="field-label">
        {k.waTemplate}
        <select
          value={choice}
          onChange={(e) => {
            setChoice(Number(e.target.value));
            setValues([]);
          }}
          className="input"
        >
          {templates.map((x, i) => (
            <option key={`${x.name}-${x.language}`} value={i}>
              {x.name} ({x.language})
            </option>
          ))}
        </select>
      </label>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {Array.from({ length: tpl.params }, (_, i) => (
          <label key={i} className="field-label">
            {`{{${i + 1}}}`}
            <input value={values[i] ?? ""} onChange={(e) => setValues((v) => Object.assign([...v], { [i]: e.target.value }))} maxLength={1024} className="input" />
          </label>
        ))}
      </div>
      <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted px-2 py-1.5 text-xs">{preview}</p>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
      <button
        type="button"
        disabled={pending || values.filter(Boolean).length < tpl.params}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const res = await api<MessageDto>(`/inbox/conversations/${conversationId}/template`, "POST", { name: tpl.name, language: tpl.language, params: values.slice(0, tpl.params) });
            if (!res.ok) return setError(errorMessage(t, res.code, res.details));
            setValues([]);
            onSent();
          })
        }
        className="btn-primary mt-2 h-8 text-xs"
      >
        {k.sendTemplate}
      </button>
    </div>
  );
}

export function ConversationView({
  conversation: c,
  templates,
  backHref,
  ai: initialAi,
}: {
  conversation: ConversationDetailDto;
  templates: CannedResponseDto[];
  backHref: string;
  ai: MeResponse["ai"];
}) {
  const { t, locale } = useI18n();
  const k = t.inbox;
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("reply");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [showTemplates, setShowTemplates] = useState(false);
  const [ai, setAi] = useState(initialAi);
  const [aiBusy, setAiBusy] = useState<"reply" | "summary" | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [draftFromAi, setDraftFromAi] = useState(false);
  // Why the AI buttons can't be used right now (they stay visible, with the reason)
  const aiBlocked = !ai.available ? t.errors.AI_UNAVAILABLE : ai.limit === 0 ? k.aiNoPlan : ai.used >= ai.limit ? k.aiLimit : null;

  async function askAi(kind: "reply" | "summary") {
    if (kind === "reply" && body.trim() && !window.confirm(k.aiReplace)) return;
    setAiBusy(kind);
    setError(undefined);
    const res = await api<AiTextDto>(`/inbox/conversations/${c.id}/ai/${kind}`, "POST");
    setAiBusy(null);
    if (!res.ok) return setError(errorMessage(t, res.code, res.details));
    setAi((x) => ({ ...x, ...res.data.usage }));
    setAiModel(res.data.model);
    if (kind === "summary") setSummary(res.data.text);
    else {
      setMode("reply");
      setBody(res.data.text);
      setDraftFromAi(true);
    }
  }
  const [pending, startTransition] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const windowClosed = !!c.replyWindowEndsAt && new Date(c.replyWindowEndsAt).getTime() < Date.now();
  const canSend = c.can.reply && !(mode === "reply" && windowClosed);
  const fileInput = useRef<HTMLInputElement>(null);
  const [waTemplate, setWaTemplate] = useState(false);
  const templateOpen = mode === "reply" && !c.optedOut && c.templates.length > 0 && (windowClosed || waTemplate);

  function sendFile(file: File) {
    setError(undefined);
    const form = new FormData();
    form.set("file", file);
    if (body.trim()) form.set("caption", body.trim());
    startTransition(async () => {
      const res = await api<MessageDto>(`/inbox/conversations/${c.id}/files`, "POST", form);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setBody("");
      router.refresh();
    });
  }

  // Opening a conversation marks it read
  useEffect(() => {
    if (c.unreadCount > 0) void api(`/inbox/conversations/${c.id}/read`, "POST").then(() => router.refresh());
  }, [c.id, c.unreadCount, router]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [c.messages.length]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!body.trim() || !canSend) return;
    setError(undefined);
    const sent = body;
    startTransition(async () => {
      const res = await api<MessageDto>(`/inbox/conversations/${c.id}/messages`, "POST", { body: sent, internal: mode === "note" });
      if (!res.ok) return setError(errorMessage(t, res.code));
      // The live stream may refresh the page before this response arrives and the agent
      // may already be typing the next message — clear only what was actually sent
      setBody((current) => (current === sent ? "" : current));
      setDraftFromAi(false);
      router.refresh();
    });
  }

  function setStatus(status: "OPEN" | "PENDING" | "RESOLVED") {
    startTransition(async () => {
      const res = await api(`/inbox/conversations/${c.id}`, "PATCH", { status });
      if (!res.ok) setError(errorMessage(t, res.code));
      router.refresh();
    });
  }

  /** "/salam " expands the matching canned reply */
  function onChange(value: string) {
    const m = /(^|\s)(\/[\p{L}\p{N}_-]+) $/u.exec(value);
    const hit = m && templates.find((x) => x.shortcut === m[2]);
    setBody(hit ? value.slice(0, value.length - m[2]!.length - 1) + hit.body : value);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Link href={backHref} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted lg:hidden" aria-label={k.back}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <ChannelIcon channel={c.channel.type} label={t.channels.types[c.channel.type]} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-semibold">
            {c.displayName || k.visitor}
            {c.channel.demo && <DemoBadge label={t.channels.demoBadge} />}
          </p>
          <p className="truncate text-xs text-fg-subtle">
            {c.channel.name}
            {c.handle && ` · ${c.handle}`}
          </p>
        </div>
        {c.can.reply &&
          (c.status === "RESOLVED" ? (
            <button type="button" onClick={() => setStatus("OPEN")} disabled={pending} className="btn-ghost h-8 text-xs">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {k.reopen}
            </button>
          ) : (
            <>
              {c.status !== "PENDING" && (
                <button type="button" onClick={() => setStatus("PENDING")} disabled={pending} className="btn-ghost h-8 text-xs">
                  {k.pending}
                </button>
              )}
              <button type="button" onClick={() => setStatus("RESOLVED")} disabled={pending} className="btn-primary h-8 text-xs">
                <Check className="h-3.5 w-3.5" aria-hidden />
                {k.resolve}
              </button>
            </>
          ))}
      </header>

      {summary && (
        <section className="border-b border-border bg-accent-soft/40 px-4 py-3" aria-label={k.aiSummaryTitle}>
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
            <h3 className="flex-1 text-xs font-semibold">
              {k.aiSummaryTitle}
              {aiModel && <span className="ml-2 font-normal text-fg-subtle">{aiModel}</span>}
            </h3>
            <button type="button" onClick={() => setSummary(null)} className="grid h-6 w-6 place-items-center rounded-md text-fg-muted hover:bg-muted" aria-label={k.close}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{summary}</p>
        </section>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-muted/30 px-4 py-4" role="log" aria-live="polite">
        {c.messages.map((m) =>
          m.direction === "INTERNAL_NOTE" ? (
            <div key={m.id} className="mx-auto max-w-[85%] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
              <p className="flex items-center gap-1 text-[11px] font-medium text-warning">
                <StickyNote className="h-3 w-3" aria-hidden />
                {interpolate(k.noteLabel, { name: m.author?.name ?? "" })}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{m.body}</p>
              <Attachments items={m.attachments} outbound={false} notStored={k.fileNotStored} />
              <p className="mt-0.5 text-[11px] text-fg-subtle">{formatDateTime(m.createdAt, locale)}</p>
            </div>
          ) : (
            <div key={m.id} className={clsx("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
              <div
                className={clsx(
                  "max-w-[80%] rounded-2xl px-3.5 py-2",
                  m.direction === "OUTBOUND" ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md border border-border bg-surface",
                )}
              >
                {m.body && <p className="whitespace-pre-wrap text-sm">{m.body}</p>}
                <Attachments items={m.attachments} outbound={m.direction === "OUTBOUND"} notStored={k.fileNotStored} />
                <p className={clsx("mt-0.5 flex items-center justify-end gap-1 text-[11px]", m.direction === "OUTBOUND" ? "text-accent-fg/75" : "text-fg-subtle")}>
                  {m.direction === "OUTBOUND" && (m.author ? <span>{m.author.name} ·</span> : <span>{k.autoReply} ·</span>)}
                  {formatDateTime(m.createdAt, locale)}
                  {m.deliveryStatus && m.deliveryStatus !== "sent" && (
                    <span className={clsx(m.deliveryStatus === "failed" && "font-semibold text-red-200")}>
                      · {k.delivery[m.deliveryStatus as keyof typeof k.delivery] ?? m.deliveryStatus}
                    </span>
                  )}
                </p>
              </div>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      {c.can.reply && (
        <form onSubmit={submit} className="border-t border-border bg-surface p-3">
          <div role="tablist" aria-label={`${k.reply} / ${k.note}`} className="mb-2 flex flex-wrap items-center gap-1">
            {(["reply", "note"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={clsx(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  mode === m ? (m === "reply" ? "bg-accent text-accent-fg" : "bg-warning/20 text-warning") : "text-fg-muted hover:bg-muted",
                )}
              >
                {m === "reply" ? k.reply : k.note}
              </button>
            ))}
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <span className="hidden text-[11px] text-fg-subtle sm:inline">{ai.limit > 0 && interpolate(k.aiUsage, { used: ai.used, limit: ai.limit })}</span>
              <button
                type="button"
                onClick={() => void askAi("summary")}
                disabled={!!aiBlocked || !!aiBusy}
                title={aiBlocked ?? undefined}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-muted disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {aiBusy === "summary" ? k.aiWorking : k.aiSummary}
              </button>
              <button
                type="button"
                onClick={() => void askAi("reply")}
                disabled={!!aiBlocked || !!aiBusy}
                title={aiBlocked ?? undefined}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {aiBusy === "reply" ? k.aiWorking : k.aiReply}
              </button>
            </div>
            {c.templates.length > 0 && !windowClosed && !c.optedOut && (
              <button type="button" aria-pressed={waTemplate} onClick={() => setWaTemplate((v) => !v)} className={clsx("rounded-md px-2 py-1 text-xs", waTemplate ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-muted")}>
                {k.waTemplateToggle}
              </button>
            )}
            <div className="relative">
              <button type="button" onClick={() => setShowTemplates((v) => !v)} aria-expanded={showTemplates} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-muted">
                <MessageSquareQuote className="h-3.5 w-3.5" aria-hidden />
                {k.templates}
              </button>
              {showTemplates && (
                <ul className="card absolute bottom-8 right-0 z-10 max-h-60 w-72 overflow-y-auto py-1 shadow-lg">
                  {templates.length === 0 && <li className="px-3 py-2 text-xs text-fg-muted">{k.noTemplates}</li>}
                  {templates.map((x) => (
                    <li key={x.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setBody((b) => (b ? `${b} ${x.body}` : x.body));
                          setShowTemplates(false);
                        }}
                        className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                      >
                        <span className="font-mono text-accent">{x.shortcut}</span> <span className="text-fg-muted">{x.body}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {c.optedOut && (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {k.optedOut}
            </p>
          )}
          {mode === "reply" && windowClosed && (
            <>
              <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {k.windowClosed} {!c.optedOut && k.windowTemplateHint}
              </p>
            </>
          )}
          {templateOpen && <TemplateComposer conversationId={c.id} templates={c.templates} onSent={() => router.refresh()} t={t} />}
          {draftFromAi && mode === "reply" && body && (
            <p className="mb-2 flex items-center gap-1.5 text-[11px] text-accent">
              <Sparkles className="h-3 w-3" aria-hidden />
              {k.aiDraftHint}
              {aiModel && <span className="text-fg-subtle">· {aiModel}</span>}
            </p>
          )}
          <label className="sr-only" htmlFor="composer">
            {mode === "reply" ? k.reply : k.note}
          </label>
          <textarea
            id="composer"
            value={body}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            rows={3}
            maxLength={4096}
            disabled={!canSend}
            placeholder={mode === "reply" ? k.replyPlaceholder : k.notePlaceholder}
            className={clsx(
              "block w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-60",
              mode === "reply" ? "border-border bg-surface focus:border-accent" : "border-warning/40 bg-warning/5 focus:border-warning",
            )}
          />
          {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[11px] text-fg-subtle">
              {c.canSendFiles && mode === "reply" && canSend && (
                <>
                  <input
                    ref={fileInput}
                    type="file"
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) sendFile(file);
                    }}
                  />
                  <button type="button" disabled={pending} onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-muted">
                    <Paperclip className="h-3.5 w-3.5" aria-hidden />
                    {k.attachFile}
                  </button>
                </>
              )}
              {c.replyWindowEndsAt && !windowClosed ? interpolate(k.windowEnds, { date: formatDateTime(c.replyWindowEndsAt, locale) }) : ""}
            </span>
            <button
              type="submit"
              disabled={pending || !body.trim() || !canSend}
              className={clsx(mode === "reply" ? "btn-primary" : "inline-flex h-9 items-center rounded-lg bg-warning px-3.5 text-sm font-semibold text-white disabled:opacity-60")}
            >
              {mode === "reply" ? k.send : k.addNote}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
