"use client";

import type { NotificationDto, NotificationListResponse } from "@axis/shared";
import clsx from "clsx";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { formatRelative } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { interpolate } from "@/lib/i18n/locales";

export function NotificationBell({ unread: initialUnread }: { unread: number }) {
  const { t, locale } = useI18n();
  const n = t.notifications;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationListResponse | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUnread(initialUnread);
  }, [initialUnread]);

  useEffect(() => {
    if (!open) return;
    void api<NotificationListResponse>("/notifications").then((res) => {
      if (res.ok) {
        setData(res.data);
        setUnread(res.data.unread);
      }
    });
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const text = (x: NotificationDto) =>
    interpolate(n[x.type], { actor: String(x.payload.actorName ?? ""), title: String(x.payload.title ?? "") });

  async function openItem(x: NotificationDto) {
    if (!x.readAt) {
      await api(`/notifications/${x.id}/read`, "POST");
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
    if (x.type.startsWith("billing_")) router.push("/settings/billing");
    else if (x.type === "support_reply" && x.payload.ticketId) router.push(`/support/${x.payload.ticketId}`);
    else if (x.payload.taskId) router.push(`/tasks/${x.payload.taskId}`);
    else if (x.payload.dealId) router.push(`/deals/${x.payload.dealId}`);
    else if (x.payload.conversationId) router.push(`/inbox?c=${x.payload.conversationId}`);
    else if (x.payload.contactId) router.push(`/crm/${x.payload.contactId}`);
    router.refresh();
  }

  async function markAll() {
    await api("/notifications/read-all", "POST");
    setUnread(0);
    setData((d) => d && { unread: 0, items: d.items.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) });
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unread ? `${n.title} (${unread})` : n.title}
        title={n.title}
        className="relative grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:bg-muted hover:text-fg"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="tabular absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label={n.title} className="card absolute right-0 top-10 z-30 w-[min(92vw,360px)] overflow-hidden shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">{n.title}</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-xs font-medium text-accent hover:underline">
                {n.markAll}
              </button>
            )}
          </div>
          {data === null ? (
            <p className="px-4 py-6 text-sm text-fg-muted">…</p>
          ) : data.items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">{n.empty}</p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {data.items.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => openItem(x)} className={clsx("flex w-full gap-2.5 px-4 py-2.5 text-left hover:bg-muted/60", !x.readAt && "bg-accent-soft/40")}>
                    <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", x.readAt ? "bg-transparent" : x.type === "task_overdue" ? "bg-danger" : "bg-accent")} />
                    <span className="min-w-0">
                      <span className="block text-sm leading-snug">{text(x)}</span>
                      <span className="text-xs text-fg-subtle">{formatRelative(x.createdAt, new Date(), locale)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
