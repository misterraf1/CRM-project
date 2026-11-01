"use client";

import { WEBHOOK_EVENTS, type WebhookDeliveryDto, type WebhookEndpointDto, type WebhookEvent } from "@/shared";
import clsx from "clsx";
import { Send, Trash2, Webhook } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { api, type ClientResult } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/** Outgoing webhooks: address, events, signing secret, a test and the delivery log. */
export function WebhooksCard({ initial }: { initial: WebhookEndpointDto[] }) {
  const { t, locale } = useI18n();
  const k = t.integrations.hooks;
  const [hooks, setHooks] = useState(initial);
  const [events, setEvents] = useState<WebhookEvent[]>(["contact.created", "deal.stage_changed"]);
  const [open, setOpen] = useState<string | null>(null);
  const [log, setLog] = useState<WebhookDeliveryDto[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string }>();
  const [pending, startTransition] = useTransition();

  const fail = (res: Extract<ClientResult<unknown>, { ok: false }>) => {
    const reason = (res.details as { url?: string[] } | undefined)?.url?.[0] as keyof typeof k.urlErrors | undefined;
    setNote({ ok: false, text: (reason && k.urlErrors[reason]) || errorMessage(t, res.code) || t.errors.INTERNAL });
  };

  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      setNote(undefined);
      const res = await api<WebhookEndpointDto>("/integrations/webhooks", "POST", { url: String(data.get("url") ?? ""), description: String(data.get("description") ?? ""), events });
      if (!res.ok) return fail(res);
      setHooks((all) => [res.data, ...all]);
      form.reset();
    });
  };

  const patch = (h: WebhookEndpointDto, body: object) =>
    startTransition(async () => {
      const res = await api<WebhookEndpointDto>(`/integrations/webhooks/${h.id}`, "PATCH", body);
      if (!res.ok) return fail(res);
      setHooks((all) => all.map((x) => (x.id === h.id ? res.data : x)));
    });

  const remove = (h: WebhookEndpointDto) =>
    window.confirm(k.confirmRemove) &&
    startTransition(async () => {
      const res = await api<WebhookEndpointDto[]>(`/integrations/webhooks/${h.id}`, "DELETE");
      if (!res.ok) return fail(res);
      setHooks(res.data);
    });

  const showLog = (h: WebhookEndpointDto) =>
    startTransition(async () => {
      if (open === h.id) return setOpen(null);
      const res = await api<WebhookDeliveryDto[]>(`/integrations/webhooks/${h.id}/deliveries`);
      if (!res.ok) return fail(res);
      setLog(res.data);
      setOpen(h.id);
    });

  const test = (h: WebhookEndpointDto) =>
    startTransition(async () => {
      setNote(undefined);
      const res = await api<WebhookDeliveryDto>(`/integrations/webhooks/${h.id}/test`, "POST");
      if (!res.ok) return fail(res);
      const d = res.data;
      setNote(d.status === "success" ? { ok: true, text: interpolate(k.testOk, { status: d.responseStatus ?? "" }) } : { ok: false, text: interpolate(k.testFail, { error: d.error ?? "" }) });
      const list = await api<WebhookDeliveryDto[]>(`/integrations/webhooks/${h.id}/deliveries`);
      if (list.ok) (setLog(list.data), setOpen(h.id));
    });

  return (
    <section id="webhooks" className="card space-y-4 p-5" aria-labelledby="hooks-title" aria-busy={pending}>
      <div>
        <h2 id="hooks-title" className="flex items-center gap-2 text-sm font-semibold">
          <Webhook className="h-4 w-4 text-accent" aria-hidden />
          {k.title}
        </h2>
        <p className="mt-0.5 max-w-2xl text-xs text-fg-muted">{k.subtitle}</p>
      </div>

      <form onSubmit={add} className="space-y-3 rounded-xl border border-border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-xs font-medium text-fg-muted">{k.url}</span>
            <input name="url" type="url" required maxLength={500} placeholder="https://hooks.example.com/axis" className="input mt-1" />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-fg-muted">{k.description}</span>
            <input name="description" maxLength={200} className="input mt-1" />
          </label>
        </div>
        <fieldset>
          <legend className="text-xs font-medium text-fg-muted">{k.events}</legend>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={events.includes(ev)} onChange={() => setEvents((all) => (all.includes(ev) ? all.filter((x) => x !== ev) : [...all, ev]))} className="h-4 w-4" />
                {k.eventLabels[ev]}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={pending || !events.length} className="btn-primary">
          {k.add}
        </button>
      </form>

      {note && (
        <p role={note.ok ? "status" : "alert"} className={clsx("text-sm", note.ok ? "text-success" : "text-danger")}>
          {note.text}
        </p>
      )}

      {hooks.length === 0 ? (
        <p className="text-sm text-fg-muted">{k.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {hooks.map((h) => (
            <li key={h.id} className="space-y-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", h.active ? "bg-success/10 text-success" : "bg-muted text-fg-muted")}>{h.active ? k.active : k.paused}</span>
                <p className="min-w-0 flex-1 truncate font-medium" title={h.url}>
                  {h.url}
                </p>
                <button type="button" onClick={() => test(h)} disabled={pending} className="btn-ghost h-8 gap-1 px-2 text-xs">
                  <Send className="h-3.5 w-3.5" aria-hidden />
                  {k.test}
                </button>
                <button type="button" onClick={() => patch(h, { active: !h.active })} className="btn-ghost h-8 px-2 text-xs">
                  {h.active ? k.pause : k.resume}
                </button>
                <button type="button" onClick={() => remove(h)} aria-label={`${k.remove}: ${h.url}`} className="grid h-8 w-8 place-items-center rounded-md text-danger hover:bg-danger/10">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <p className="text-xs text-fg-muted">
                {h.events.map((e) => k.eventLabels[e]).join(", ")}
                {h.description && ` · ${h.description}`}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-fg-muted">{k.secret}:</span>
                <code className="rounded bg-muted px-1.5 py-0.5">{shown === h.id ? h.secret : "whsec_••••••••"}</code>
                <button type="button" onClick={() => setShown(shown === h.id ? null : h.id)} className="font-medium text-accent hover:underline">
                  {shown === h.id ? k.hide : k.show}
                </button>
                <button type="button" onClick={() => showLog(h)} aria-expanded={open === h.id} className="ml-auto font-medium text-accent hover:underline">
                  {k.log}
                </button>
              </div>
              {open === h.id && (
                <ul className="divide-y divide-border rounded-lg bg-muted/40 text-xs">
                  {log.length === 0 && <li className="px-3 py-2 text-fg-muted">{k.noLog}</li>}
                  {log.map((d) => (
                    <li key={d.id} className="flex flex-wrap gap-x-3 px-3 py-1.5">
                      <span className="w-28 shrink-0 text-fg-subtle">{formatDateTime(d.createdAt, locale)}</span>
                      <span className="min-w-0 flex-1">{d.event === "ping" ? k.test : (k.eventLabels[d.event as WebhookEvent] ?? d.event)}</span>
                      <span className={d.status === "success" ? "text-success" : d.status === "failed" ? "text-danger" : "text-fg-muted"}>
                        {k.statuses[d.status]}
                        {d.responseStatus ? ` · ${d.responseStatus}` : ""}
                        {d.error && d.status !== "success" ? ` · ${d.error}` : ""}
                      </span>
                      <span className="text-fg-subtle">{interpolate(k.attempts, { n: d.attempts })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
