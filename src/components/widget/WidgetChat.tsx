"use client";

import type { WidgetConfigDto, WidgetMessageDto, WidgetSendResponse } from "@/shared";
import clsx from "clsx";
import { Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/client";

const POLL_MS = 3000;

/** Anonymous visitor chat, shown inside the iframe that public/widget.js injects. */
export function WidgetChat({ widgetKey }: { widgetKey: string }) {
  const { t } = useI18n();
  const w = t.widget;
  const storageKey = `axis-widget:${widgetKey}`;
  const base = `/api/v1/widget/${encodeURIComponent(widgetKey)}`;
  const [config, setConfig] = useState<WidgetConfigDto | null | "error">(null);
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<WidgetMessageDto[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${base}/config`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setConfig, () => setConfig("error"));
    try {
      setToken(localStorage.getItem(storageKey));
    } catch {
      /* private mode: the conversation lasts for this page view */
    }
  }, [base, storageKey]);

  const poll = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${base}/messages?visitorToken=${encodeURIComponent(token)}`).catch(() => null);
    if (res?.ok) setMessages(await res.json());
  }, [base, token]);

  useEffect(() => {
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!body.trim()) return;
    setSending(true);
    setError(false);
    const res = await fetch(`${base}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body,
        ...(token ? { visitorToken: token } : {}),
        ...(f.get("name") ? { name: String(f.get("name")) } : {}),
        ...(f.get("email") ? { email: String(f.get("email")) } : {}),
      }),
    }).catch(() => null);
    setSending(false);
    if (!res?.ok) return setError(true);
    const data = (await res.json()) as WidgetSendResponse;
    if (!token) {
      setToken(data.visitorToken);
      try {
        localStorage.setItem(storageKey, data.visitorToken);
      } catch {
        /* kept in memory only */
      }
    }
    setMessages((m) => [...m, data.message]);
    setBody("");
  }

  if (config === "error") return <p className="p-6 text-center text-sm text-fg-muted">{w.unavailable}</p>;

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="bg-accent px-4 py-3 text-accent-fg">
        <p className="text-sm font-semibold">{config?.companyName ?? "…"}</p>
        <p className="text-xs opacity-80">{w.typingHint}</p>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-3" role="log" aria-live="polite">
        {config?.greeting && (
          <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-surface px-3 py-2 text-sm">{config.greeting}</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={clsx("flex", m.from === "visitor" ? "justify-end" : "justify-start")}>
            <div
              className={clsx(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                m.from === "visitor" ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md border border-border bg-surface",
              )}
            >
              {m.from === "agent" && m.authorName && <p className="mb-0.5 text-[11px] font-semibold text-fg-subtle">{m.authorName}</p>}
              {m.body}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="space-y-2 border-t border-border p-3">
        {!token && (
          <div className="grid grid-cols-2 gap-2">
            <input name="name" maxLength={100} placeholder={w.name} aria-label={w.name} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs" />
            <input name="email" type="email" maxLength={254} placeholder={w.email} aria-label={w.email} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs" />
          </div>
        )}
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="widget-message">
            {w.placeholder}
          </label>
          <input
            id="widget-message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            placeholder={w.placeholder}
            className="h-10 min-w-0 flex-1 rounded-full border border-border bg-surface px-4 text-sm outline-none focus:border-accent"
          />
          <button type="submit" disabled={sending || !body.trim()} aria-label={w.send} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg disabled:opacity-50">
            <Send className="h-4 w-4" />
          </button>
        </div>
        {error && <p role="alert" className="text-xs text-danger">{w.error}</p>}
        <p className="text-center text-[11px] text-fg-subtle">{w.poweredBy}</p>
      </form>
    </div>
  );
}
