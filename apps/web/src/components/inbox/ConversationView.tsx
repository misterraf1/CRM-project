"use client";

import type { CannedResponseDto, ConversationDetailDto, MessageDto } from "@axis/shared";
import clsx from "clsx";
import { AlertTriangle, ArrowLeft, Check, MessageSquareQuote, RotateCcw, StickyNote } from "lucide-react";
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

export function ConversationView({ conversation: c, templates, backHref }: { conversation: ConversationDetailDto; templates: CannedResponseDto[]; backHref: string }) {
  const { t, locale } = useI18n();
  const k = t.inbox;
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("reply");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [showTemplates, setShowTemplates] = useState(false);
  const [pending, startTransition] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const windowClosed = !!c.replyWindowEndsAt && new Date(c.replyWindowEndsAt).getTime() < Date.now();
  const canSend = c.can.reply && !(mode === "reply" && windowClosed);

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
    startTransition(async () => {
      const res = await api<MessageDto>(`/inbox/conversations/${c.id}/messages`, "POST", { body, internal: mode === "note" });
      if (!res.ok) return setError(errorMessage(t, res.code));
      setBody("");
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

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-muted/30 px-4 py-4" role="log" aria-live="polite">
        {c.messages.map((m) =>
          m.direction === "INTERNAL_NOTE" ? (
            <div key={m.id} className="mx-auto max-w-[85%] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
              <p className="flex items-center gap-1 text-[11px] font-medium text-warning">
                <StickyNote className="h-3 w-3" aria-hidden />
                {interpolate(k.noteLabel, { name: m.author?.name ?? "" })}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{m.body}</p>
              <p className="mt-0.5 text-[10px] text-fg-subtle">{formatDateTime(m.createdAt, locale)}</p>
            </div>
          ) : (
            <div key={m.id} className={clsx("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
              <div
                className={clsx(
                  "max-w-[80%] rounded-2xl px-3.5 py-2",
                  m.direction === "OUTBOUND" ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md border border-border bg-surface",
                )}
              >
                <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                <p className={clsx("mt-0.5 flex items-center justify-end gap-1 text-[10px]", m.direction === "OUTBOUND" ? "text-accent-fg/75" : "text-fg-subtle")}>
                  {m.direction === "OUTBOUND" && m.author && <span>{m.author.name} ·</span>}
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
          <div role="tablist" aria-label={`${k.reply} / ${k.note}`} className="mb-2 flex gap-1">
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
            <div className="relative ml-auto">
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
          {mode === "reply" && windowClosed && (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {k.windowClosed}
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
            <span className="text-[11px] text-fg-subtle">
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
