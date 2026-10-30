"use client";

import type { ChatMessageDto, ChatRoomDetailDto, MemberDto, TaskDto } from "@/shared";
import clsx from "clsx";
import { ArrowLeft, CheckSquare, Download, ListPlus, Paperclip, Pencil, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

const MAX_BYTES = 10 * 1024 * 1024;

export function RoomView({
  room,
  myTasks,
  members,
  backHref,
}: {
  room: ChatRoomDetailDto;
  myTasks: TaskDto[];
  members: MemberDto[];
  backHref: string;
}) {
  const { t, locale } = useI18n();
  const k = t.chat;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [older, setOlder] = useState<ChatMessageDto[]>([]);
  const [hasMore, setHasMore] = useState(room.hasMore);
  const [body, setBody] = useState("");
  const [taskId, setTaskId] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; href?: string; error?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Live refreshes replace the latest page; older pages loaded on demand are kept
  const messages = useMemo(() => {
    const ids = new Set(room.messages.map((m) => m.id));
    return [...older.filter((m) => !ids.has(m.id)), ...room.messages];
  }, [older, room.messages]);

  useEffect(() => {
    if (room.unread > 0) void api(`/chat/rooms/${room.id}/read`, "POST").then(() => router.refresh());
  }, [room.id, room.unread, router]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [room.messages.length]);

  // onOk returning "navigated" skips the refresh: a refresh right after router.push
  // races the navigation and can leave the old page (and room list) on screen
  const run = (fn: () => Promise<{ ok: boolean; code?: string; details?: unknown }>, onOk?: () => void | "navigated") =>
    startTransition(async () => {
      setNotice(null);
      const res = await fn();
      if (!res.ok) setNotice({ text: errorMessage(t, res.code, res.details) ?? "", error: true });
      else if (onOk?.() === "navigated") return;
      router.refresh();
    });

  function send() {
    if (!body.trim() && !taskId) return;
    const sent = body;
    run(
      () => api(`/chat/rooms/${room.id}/messages`, "POST", { ...(sent.trim() ? { body: sent } : {}), ...(taskId ? { taskId } : {}) }),
      () => {
        // A live refresh can arrive first; keep anything typed since sending
        setBody((current) => (current === sent ? "" : current));
        setTaskId("");
      },
    );
  }

  function upload(file: File) {
    if (file.size > MAX_BYTES) return setNotice({ text: t.errors.FILE_TOO_LARGE, error: true });
    const form = new FormData();
    form.append("file", file);
    const caption = body;
    if (caption.trim()) form.append("body", caption);
    run(
      () => api(`/chat/rooms/${room.id}/files`, "POST", form),
      () => setBody((current) => (current === caption ? "" : current)),
    );
    if (fileInput.current) fileInput.current.value = "";
  }

  async function loadOlder() {
    const res = await api<ChatRoomDetailDto>(`/chat/rooms/${room.id}?before=${messages[0]?.id ?? ""}`);
    if (res.ok) {
      setOlder((o) => [...res.data.messages, ...o]);
      setHasMore(res.data.hasMore);
    }
  }

  function toTask(m: ChatMessageDto) {
    const text = (m.body ?? "").trim();
    startTransition(async () => {
      const res = await api<TaskDto>("/tasks", "POST", { title: text.slice(0, 200) || k.toTask, description: text || null });
      setNotice(res.ok ? { text: k.taskCreated, href: `/tasks/${res.data.id}` } : { text: errorMessage(t, res.code) ?? "", error: true });
    });
  }

  const nonMembers = members.filter((m) => m.status === "ACTIVE" && !room.members.some((x) => x.id === m.id));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Link href={backHref} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted lg:hidden" aria-label={k.title}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{room.name}</h2>
          <p className="truncate text-xs text-fg-subtle" title={room.members.map((m) => m.name).join(", ")}>
            {k.kinds[room.kind]} · {interpolate(k.members, { n: room.memberCount })}
          </p>
        </div>
        {room.can.addMembers && nonMembers.length > 0 && (
          <select
            aria-label={k.addMember}
            value=""
            onChange={(e) => e.target.value && run(() => api(`/chat/rooms/${room.id}/members`, "POST", { memberIds: [e.target.value] }))}
            className="h-8 rounded-lg border border-border bg-surface px-2 text-xs"
          >
            <option value="">{k.addMember}</option>
            {nonMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </select>
        )}
        {room.can.leave && (
          <button
            type="button"
            onClick={() =>
              window.confirm(interpolate(k.confirmLeave, { name: room.name })) &&
              run(
                () => api(`/chat/rooms/${room.id}/members/me`, "DELETE"),
                () => {
                  // A full load: the client cache may still hold the room list with this room in it
                  window.location.assign("/chat");
                  return "navigated";
                },
              )
            }
            className="btn-danger h-8 text-xs"
          >
            {k.leave}
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" role="log" aria-live="polite">
        {hasMore && (
          <button type="button" onClick={loadOlder} className="mx-auto block text-xs font-medium text-accent hover:underline">
            {k.older}
          </button>
        )}
        {messages.length === 0 && <p className="py-10 text-center text-sm text-fg-subtle">{k.noMessages}</p>}
        {messages.map((m) => (
          <div key={m.id} className={clsx("group flex gap-2.5", m.mine && "flex-row-reverse")}>
            {!m.mine && <Avatar name={m.author?.name ?? "?"} size="sm" />}
            <div className={clsx("max-w-[78%] min-w-0", m.mine && "items-end text-right")}>
              <p className="text-[11px] text-fg-subtle">
                {m.mine ? k.you : m.author?.name} · {formatDateTime(m.createdAt, locale)}
                {m.editedAt && ` · ${k.edited}`}
              </p>
              <div
                className={clsx(
                  "mt-0.5 inline-block rounded-2xl px-3 py-2 text-left text-sm",
                  m.mine ? "rounded-tr-md bg-success/15" : "rounded-tl-md bg-muted",
                )}
              >
                {editing?.id === m.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(
                        () => api(`/chat/messages/${m.id}`, "PATCH", { body: editing.body }),
                        () => setEditing(null),
                      );
                    }}
                    className="flex gap-1.5"
                  >
                    <input value={editing.body} onChange={(e) => setEditing({ id: m.id, body: e.target.value })} aria-label={k.edit} className="h-8 min-w-48 rounded-md border border-border bg-surface px-2 text-sm" autoFocus />
                    <button type="submit" className="btn-primary h-8 text-xs">
                      {k.save}
                    </button>
                  </form>
                ) : (
                  m.body && <p className="whitespace-pre-wrap">{m.body}</p>
                )}
                {m.attachments.map((a) => (
                  <a key={a.fileId} href={`/api/v1/files/${a.fileId}`} download={a.name} className="mt-1 flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    {a.name}
                  </a>
                ))}
                {m.task && (
                  <Link href={`/tasks/${m.task.id}`} className="mt-1 flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs hover:border-accent">
                    <CheckSquare className="h-3.5 w-3.5 text-accent" aria-hidden />
                    <span className="truncate">{m.task.title}</span>
                    <span className="shrink-0 text-fg-subtle">· {t.tasks.statuses[m.task.status]}</span>
                  </Link>
                )}
              </div>
              <div className={clsx("mt-0.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100", m.mine && "justify-end")}>
                {m.body && (
                  <button type="button" onClick={() => toTask(m)} title={k.toTask} aria-label={`${k.toTask}: ${m.body.slice(0, 40)}`} className="grid h-6 w-6 place-items-center rounded text-fg-subtle hover:bg-muted hover:text-accent">
                    <ListPlus className="h-3.5 w-3.5" />
                  </button>
                )}
                {m.mine && m.body && (
                  <button type="button" onClick={() => setEditing({ id: m.id, body: m.body ?? "" })} title={k.edit} aria-label={k.edit} className="grid h-6 w-6 place-items-center rounded text-fg-subtle hover:bg-muted hover:text-fg">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {m.mine && (
                  <button
                    type="button"
                    onClick={() => window.confirm(k.confirmDelete) && run(() => api(`/chat/messages/${m.id}`, "DELETE"))}
                    title={k.delete}
                    aria-label={k.delete}
                    className="grid h-6 w-6 place-items-center rounded text-fg-subtle hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t border-border p-3"
        aria-busy={pending}
      >
        {notice && (
          <p role={notice.error ? "alert" : "status"} className={clsx("mb-2 text-xs", notice.error ? "text-danger" : "text-success")}>
            {notice.text}
            {notice.href && (
              <Link href={notice.href} className="ml-1 font-medium underline">
                →
              </Link>
            )}
          </p>
        )}
        {myTasks.length > 0 && (
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label={k.linkTask} className="mb-2 h-8 w-full rounded-lg border border-border bg-surface px-2 text-xs text-fg-muted">
            <option value="">{k.linkTask}…</option>
            {myTasks.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-end gap-2">
          <label className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-fg-muted hover:bg-muted" title={k.attach}>
            <Paperclip className="h-4 w-4" aria-hidden />
            <span className="sr-only">{k.attach}</span>
            <input ref={fileInput} type="file" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <label className="sr-only" htmlFor="chat-composer">
            {k.placeholder}
          </label>
          <textarea
            id="chat-composer"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={k.placeholder}
            className="max-h-32 min-h-10 flex-1 resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button type="submit" disabled={pending || (!body.trim() && !taskId)} aria-label={k.send} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg disabled:opacity-50">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
