"use client";

import type { AiTextDto, CannedResponseDto, ConversationDetailDto, MeResponse, MessageAttachmentDto, MessageDto, WhatsAppTemplateDto } from "@/shared";
import clsx from "clsx";
import { AlertTriangle, ArrowLeft, Ban, Check, CheckCheck, Clock, FileText, MessageSquareQuote, MoreHorizontal, Paperclip, Phone, Plus, RotateCcw, SendHorizontal, Smile, Sparkles, Star, StickyNote, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { DemoBadge } from "@/components/ui/Card";
import { MenuItem, Popover } from "@/components/ui/Popover";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { api } from "@/lib/api/client";
import { dayKey, formatDate, formatDateTime, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

type Mode = "reply" | "note";

const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Files in a message: photos as a thumbnail grid, everything else as download links. */
function Attachments({ items, notStored }: { items: MessageAttachmentDto[]; notStored: string }) {
  if (!items.length) return null;
  const photos = items.filter((a) => a.fileId && PREVIEWABLE.has(a.mimeType));
  const files = items.filter((a) => !photos.includes(a));
  const shown = photos.slice(0, 3);
  return (
    <>
      {shown.length > 0 && (
        <ul className={clsx("mt-1 grid gap-1.5", shown.length === 1 ? "grid-cols-1" : shown.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
          {shown.map((a, i) => (
            <li key={a.fileId}>
              <a href={`/api/v1/files/${a.fileId}`} download={a.name} title={a.name} className="relative block overflow-hidden rounded-xl">
                {/* eslint-disable-next-line @next/next/no-img-element -- private files behind the session cookie */}
                <img src={`/api/v1/files/${a.fileId}?inline=1`} alt={a.name} loading="lazy" className={clsx("w-full object-cover", shown.length === 1 ? "max-h-72" : "aspect-square")} />
                {i === 2 && photos.length > 3 && (
                  <span className="absolute inset-0 grid place-items-center bg-black/50 text-lg font-semibold text-white">+{photos.length - 3}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="mt-1 space-y-1">
          {files.map((a, i) => (
            <li key={a.fileId ?? i}>
              {a.fileId ? (
                <a href={`/api/v1/files/${a.fileId}`} download={a.name} className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-surface/70 px-2 py-1 text-xs underline-offset-2 hover:underline">
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
      )}
    </>
  );
}

/** Sent / delivered / read as ticks; anything else (demo, queued, failed…) in words. */
function Delivery({ status, labels }: { status: string | null; labels: Record<string, string> }) {
  if (!status) return null;
  if (status === "sent") return <Check className="h-3.5 w-3.5" aria-label={labels.sent} />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5" aria-label={labels.delivered} />;
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-accent" aria-label={labels.read} />;
  if (status === "pending" || status === "queued") return <Clock className="h-3 w-3" aria-label={labels[status]} />;
  return <span className={clsx(status === "failed" && "font-semibold text-danger")}>· {labels[status] ?? status}</span>;
}

const EMOJI = ["😊", "👍", "🙏", "❤️", "😂", "🎉", "👋", "✅", "🔥", "🤝", "📞", "📦", "🚗", "💳", "📍", "⏰"];

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
  const [ai, setAi] = useState(initialAi);
  const [aiBusy, setAiBusy] = useState<"reply" | "summary" | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [draftFromAi, setDraftFromAi] = useState(false);
  const [starred, setStarred] = useState(c.starred);
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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const windowClosed = !!c.replyWindowEndsAt && new Date(c.replyWindowEndsAt).getTime() < Date.now();
  const canSend = c.can.reply && !(mode === "reply" && windowClosed);
  const fileInput = useRef<HTMLInputElement>(null);
  const [waTemplate, setWaTemplate] = useState(false);
  const templateOpen = mode === "reply" && !c.optedOut && c.templates.length > 0 && (windowClosed || waTemplate);
  const phone = /^\+?[\d\s()-]{7,}$/.test(c.handle) ? c.handle.replace(/[\s()-]/g, "") : null;
  const name = c.displayName || k.visitor;

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

  function patch(input: { status?: "OPEN" | "PENDING" | "RESOLVED"; starred?: boolean }) {
    startTransition(async () => {
      const res = await api(`/inbox/conversations/${c.id}`, "PATCH", input);
      if (!res.ok) {
        setError(errorMessage(t, res.code));
        if (input.starred !== undefined) setStarred(!input.starred);
      }
      router.refresh();
    });
  }

  /** "/salam " expands the matching canned reply */
  function onChange(value: string) {
    const m = /(^|\s)(\/[\p{L}\p{N}_-]+) $/u.exec(value);
    const hit = m && templates.find((x) => x.shortcut === m[2]);
    setBody(hit ? value.slice(0, value.length - m[2]!.length - 1) + hit.body : value);
  }

  const insert = (text: string) => {
    setBody((b) => (b ? `${b}${/\s$/.test(b) ? "" : " "}${text}` : text));
    textarea.current?.focus();
  };

  // Day separators: "Today", "Yesterday", else the date
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const dayLabel = (iso: string) => {
    const d = dayKey(iso);
    return d === today ? k.today : d === yesterday ? k.yesterday : formatDate(iso, locale, "long");
  };
  const iconBtn = "grid h-9 w-9 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-muted hover:text-fg disabled:opacity-50";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href={backHref} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted lg:hidden" aria-label={k.back}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="relative shrink-0">
          <Avatar name={name} size="lg" />
          <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-surface">
            <ChannelIcon channel={c.channel.type} label={t.channels.types[c.channel.type]} size="sm" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-base font-semibold">
            <span className="truncate">{name}</span>
            {c.channel.demo && (
              <span className="hidden sm:inline-flex">
                <DemoBadge label={t.channels.demoBadge} />
              </span>
            )}
          </p>
          <p className="truncate text-xs text-fg-muted">{c.handle || c.channel.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {c.can.reply && (
            <button
              type="button"
              aria-pressed={starred}
              aria-label={starred ? k.unstar : k.star}
              title={starred ? k.unstar : k.star}
              disabled={pending}
              onClick={() => {
                setStarred(!starred);
                patch({ starred: !starred });
              }}
              className={iconBtn}
            >
              <Star className={clsx("h-[18px] w-[18px]", starred && "fill-warning text-warning")} />
            </button>
          )}
          {phone && (
            <a href={`tel:${phone}`} aria-label={k.call} title={k.call} className={iconBtn}>
              <Phone className="h-[18px] w-[18px]" />
            </a>
          )}
          {c.can.reply &&
            (c.status === "RESOLVED" ? (
              <button type="button" onClick={() => patch({ status: "OPEN" })} disabled={pending} className="btn-ghost ml-1 h-9 border border-border text-xs">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {k.reopen}
              </button>
            ) : (
              <button type="button" onClick={() => patch({ status: "RESOLVED" })} disabled={pending} className="btn-primary ml-1 h-9 px-3 text-xs">
                <Check className="h-4 w-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">{k.resolve}</span>
              </button>
            ))}
          <Popover label={k.more} trigger={<MoreHorizontal className="h-[18px] w-[18px]" />} className={iconBtn} panelClassName="w-56">
            {(close) => (
              <>
                {c.can.reply && c.status === "OPEN" && (
                  <MenuItem icon={<Clock className="h-4 w-4" />} onClick={() => (close(), patch({ status: "PENDING" }))}>
                    {k.pending}
                  </MenuItem>
                )}
                <MenuItem icon={<Sparkles className="h-4 w-4" />} disabled={!!aiBlocked || !!aiBusy} title={aiBlocked ?? undefined} onClick={() => (close(), void askAi("summary"))}>
                  {aiBusy === "summary" ? k.aiWorking : k.aiSummary}
                </MenuItem>
                {ai.limit > 0 && <p className="px-2.5 pb-1 pt-0.5 text-[11px] text-fg-subtle">{interpolate(k.aiUsage, { used: ai.used, limit: ai.limit })}</p>}
              </>
            )}
          </Popover>
        </div>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6" role="log" aria-live="polite">
        <div className="space-y-2.5">
          {c.messages.map((m, i) => {
            const newDay = i === 0 || dayKey(m.createdAt) !== dayKey(c.messages[i - 1]!.createdAt);
            const separator = newDay && (
              <p className="flex justify-center py-2">
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-fg-muted">{dayLabel(m.createdAt)}</span>
              </p>
            );
            if (m.direction === "INTERNAL_NOTE") {
              return (
                <div key={m.id}>
                  {separator}
                  <div className="mx-auto max-w-[85%] rounded-xl border border-warning/30 bg-warning/10 px-3 py-2">
                    <p className="flex items-center gap-1 text-[11px] font-medium text-warning">
                      <StickyNote className="h-3 w-3" aria-hidden />
                      {interpolate(k.noteLabel, { name: m.author?.name ?? "" })}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{m.body}</p>
                    <Attachments items={m.attachments} notStored={k.fileNotStored} />
                    <p className="mt-0.5 text-right text-[11px] text-fg-subtle">{formatTime(m.createdAt)}</p>
                  </div>
                </div>
              );
            }
            const out = m.direction === "OUTBOUND";
            return (
              <div key={m.id}>
                {separator}
                <div className={clsx("flex", out ? "justify-end" : "justify-start")}>
                  <div className={clsx("max-w-[78%] rounded-2xl px-3.5 py-2", out ? "rounded-br-md bg-accent-soft" : "rounded-bl-md bg-muted")}>
                    {m.body && <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>}
                    <Attachments items={m.attachments} notStored={k.fileNotStored} />
                    <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-fg-subtle" title={formatDateTime(m.createdAt, locale)}>
                      {out && (m.author ? <span>{m.author.name} ·</span> : <span>{k.autoReply} ·</span>)}
                      {formatTime(m.createdAt)}
                      {out && <Delivery status={m.deliveryStatus} labels={k.delivery} />}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div ref={bottom} />
      </div>

      {c.can.reply && (
        <form onSubmit={submit} className="border-t border-border bg-surface px-3 pb-3 pt-2 sm:px-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label={`${k.reply} / ${k.note}`} className="flex rounded-lg bg-muted p-0.5">
              {(["reply", "note"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={clsx(
                    "rounded-md px-2.5 py-1 text-xs font-medium",
                    mode === m ? (m === "reply" ? "bg-surface text-fg shadow-sm" : "bg-warning/20 text-warning") : "text-fg-muted hover:text-fg",
                  )}
                >
                  {m === "reply" ? k.reply : k.note}
                </button>
              ))}
            </div>
            {c.replyWindowEndsAt && !windowClosed && <span className="text-[11px] text-fg-subtle">{interpolate(k.windowEnds, { date: formatDateTime(c.replyWindowEndsAt, locale) })}</span>}
          </div>
          {c.optedOut && (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {k.optedOut}
            </p>
          )}
          {mode === "reply" && windowClosed && (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {k.windowClosed} {!c.optedOut && k.windowTemplateHint}
            </p>
          )}
          {templateOpen && <TemplateComposer conversationId={c.id} templates={c.templates} onSent={() => router.refresh()} t={t} />}
          {draftFromAi && mode === "reply" && body && (
            <p className="mb-2 flex items-center gap-1.5 text-[11px] text-accent">
              <Sparkles className="h-3 w-3" aria-hidden />
              {k.aiDraftHint}
              {aiModel && <span className="text-fg-subtle">· {aiModel}</span>}
            </p>
          )}
          <div className="flex items-end gap-2">
            <Popover label={k.tools} side="top" align="left" trigger={<Plus className="h-5 w-5" />} className="grid h-11 w-11 place-items-center rounded-xl border border-border text-fg-muted hover:bg-muted hover:text-fg" panelClassName="w-72">
              {(close) => (
                <ToolsMenu
                  close={close}
                  templates={templates}
                  onTemplate={insert}
                  ai={{ blocked: aiBlocked, busy: aiBusy, label: aiBusy === "reply" ? k.aiWorking : k.aiReply, run: () => void askAi("reply") }}
                  wa={c.templates.length > 0 && !windowClosed && !c.optedOut ? { on: waTemplate, toggle: () => setWaTemplate((v) => !v) } : null}
                />
              )}
            </Popover>
            <div
              className={clsx(
                "flex min-w-0 flex-1 items-end rounded-xl border pl-3 pr-1 transition-colors",
                mode === "reply" ? "border-border bg-surface focus-within:border-accent" : "border-warning/40 bg-warning/5 focus-within:border-warning",
              )}
            >
              <label className="sr-only" htmlFor="composer">
                {mode === "reply" ? k.reply : k.note}
              </label>
              <textarea
                id="composer"
                ref={textarea}
                value={body}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends (Ctrl/⌘+Enter too); Shift+Enter starts a new line
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                maxLength={4096}
                disabled={!canSend}
                title={k.enterHint}
                placeholder={mode === "reply" ? k.composerPlaceholder : k.notePlaceholder}
                className="block max-h-40 min-h-[42px] flex-1 resize-none bg-transparent py-2.5 text-sm outline-none [field-sizing:content] disabled:opacity-60"
              />
              <Popover label={k.emoji} side="top" trigger={<Smile className="h-5 w-5" />} className="grid h-10 w-9 place-items-center rounded-lg text-fg-muted hover:text-fg" panelClassName="w-64">
                {(close) => (
                  <ul className="grid grid-cols-8 gap-0.5">
                    {EMOJI.map((e) => (
                      <li key={e}>
                        <button type="button" onClick={() => (insert(e), close())} className="grid h-7 w-7 place-items-center rounded-md text-lg hover:bg-muted">
                          {e}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Popover>
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
                  <button type="button" disabled={pending} onClick={() => fileInput.current?.click()} aria-label={k.attachFile} title={k.attachFile} className="grid h-10 w-9 place-items-center rounded-lg text-fg-muted hover:text-fg">
                    <Paperclip className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
            <button
              type="submit"
              disabled={pending || !body.trim() || !canSend}
              aria-label={mode === "reply" ? k.send : k.addNote}
              title={mode === "reply" ? k.send : k.addNote}
              className={clsx(
                "grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-50 dark:text-bg",
                mode === "reply" ? "bg-gradient-to-br from-accent to-brand-violet" : "bg-warning",
              )}
            >
              {mode === "reply" ? <SendHorizontal className="h-5 w-5" /> : <StickyNote className="h-5 w-5" />}
            </button>
          </div>
          {error && <p role="alert" className="mt-1.5 text-xs text-danger">{error}</p>}
        </form>
      )}
    </div>
  );
}

/** The composer's "+": AI draft, canned replies and the WhatsApp template form. */
function ToolsMenu({
  close,
  templates,
  onTemplate,
  ai,
  wa,
}: {
  close: () => void;
  templates: CannedResponseDto[];
  onTemplate: (body: string) => void;
  ai: { blocked: string | null; busy: string | null; label: string; run: () => void };
  wa: { on: boolean; toggle: () => void } | null;
}) {
  const { t } = useI18n();
  const k = t.inbox;
  const [canned, setCanned] = useState(false);
  if (canned) {
    return (
      <ul className="max-h-64 overflow-y-auto" aria-label={k.templates}>
        {templates.length === 0 && <li className="px-2.5 py-2 text-xs text-fg-muted">{k.noTemplates}</li>}
        {templates.map((x) => (
          <li key={x.id}>
            <button type="button" onClick={() => (onTemplate(x.body), close())} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted">
              <span className="font-mono text-accent">{x.shortcut}</span> <span className="text-fg-muted">{x.body}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      <MenuItem icon={<Sparkles className="h-4 w-4 text-accent" />} disabled={!!ai.blocked || !!ai.busy} title={ai.blocked ?? undefined} onClick={() => (close(), ai.run())}>
        {ai.label}
      </MenuItem>
      <MenuItem icon={<MessageSquareQuote className="h-4 w-4" />} onClick={() => setCanned(true)}>
        {k.templates}
      </MenuItem>
      {wa && (
        <MenuItem icon={<FileText className="h-4 w-4" />} pressed={wa.on} onClick={() => (close(), wa.toggle())}>
          {k.waTemplateToggle}
        </MenuItem>
      )}
    </>
  );
}
