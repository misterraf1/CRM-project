import type { ChatRoomDto } from "@axis/shared";
import clsx from "clsx";
import { Hash, Search, User, Users, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NewChat } from "@/components/chat/NewChat";
import { RoomView } from "@/components/chat/RoomView";
import { LiveRefresh } from "@/components/shell/LiveRefresh";
import { getChatRoom, getChatRooms, getMembers, getSession, getTasks, searchChat } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { formatRelative } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Chat" };

type Props = { searchParams: Promise<{ r?: string; q?: string }> };

const KIND_ICON = { department: Hash, group: Users, direct: User } satisfies Record<ChatRoomDto["kind"], unknown>;

export default async function ChatPage({ searchParams }: Props) {
  const { r, q } = await searchParams;
  const search = q && q.trim().length >= 2 ? q.trim() : undefined;
  const [{ t, locale }, me, rooms, members, hits] = await Promise.all([
    getI18n(),
    getSession(),
    getChatRooms(),
    getMembers(),
    search ? searchChat(search) : Promise.resolve(null),
  ]);
  const room = r
    ? await getChatRoom(r).catch((e) => {
        if (e instanceof ApiRequestError && e.status === 404) return null;
        throw e;
      })
    : null;
  const myTasks = room ? await getTasks({ view: "mine" }) : [];
  const k = t.chat;
  const now = new Date();

  return (
    <div className="-my-6 -mx-4 lg:-mx-6">
      <div className="grid h-[calc(100dvh-3.5rem)] grid-cols-[minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside aria-label={t.nav.chat} className={clsx("flex min-h-0 flex-col border-r border-border bg-surface", room && "hidden lg:flex")}>
          <div className="space-y-2 border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-base font-semibold">{k.title}</h1>
              <LiveRefresh url="/api/v1/chat/stream" />
            </div>
            <p className="text-[11px] text-fg-subtle">{k.subtitle}</p>
            <form action="/chat" className="relative">
              {r && <input type="hidden" name="r" value={r} />}
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-fg-subtle" aria-hidden />
              <input name="q" defaultValue={q} minLength={2} placeholder={k.search} aria-label={k.search} className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-sm outline-none focus:border-accent" />
            </form>
            <NewChat members={members} selfMemberId={me.membership.id} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {hits ? (
              <div>
                <div className="flex items-center justify-between px-3 py-2">
                  <p className="text-xs font-semibold text-fg-muted">{k.searchResults}</p>
                  <Link href={r ? `/chat?r=${r}` : "/chat"} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                    <X className="h-3 w-3" aria-hidden />
                    {k.clearSearch}
                  </Link>
                </div>
                {hits.length === 0 && <p className="px-3 py-4 text-sm text-fg-muted">{k.noResults}</p>}
                <ul className="divide-y divide-border">
                  {hits.map((h) => (
                    <li key={h.message.id}>
                      <Link href={`/chat?r=${h.room.id}`} className="block px-3 py-2.5 hover:bg-muted/60">
                        <p className="text-xs text-fg-subtle">
                          {h.room.name} · {h.message.author?.name} · {formatRelative(h.message.createdAt, now, locale)}
                        </p>
                        <p className="truncate text-sm">{h.message.body}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : rooms.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium">{k.empty}</p>
                <p className="mt-1 text-xs text-fg-muted">{k.emptyHint}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {rooms.map((x) => {
                  const Icon = KIND_ICON[x.kind];
                  return (
                    <li key={x.id}>
                      <Link
                        href={`/chat?r=${x.id}`}
                        aria-current={x.id === room?.id ? "true" : undefined}
                        className={clsx("flex gap-3 px-3 py-2.5 hover:bg-muted/60", x.id === room?.id && "bg-accent-soft/60")}
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success/10 text-success" title={k.kinds[x.kind]}>
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className={clsx("truncate text-sm", x.unread ? "font-semibold" : "font-medium")}>{x.name}</p>
                            {x.lastMessage && <span className="shrink-0 text-[11px] text-fg-subtle">{formatRelative(x.lastMessage.createdAt, now, locale)}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                              {x.lastMessage ? `${x.lastMessage.mine ? k.you : (x.lastMessage.author ?? "")}: ${x.lastMessage.body}` : k.kinds[x.kind]}
                            </p>
                            {x.unread > 0 && <span className="tabular rounded-full bg-success px-1.5 text-[11px] font-semibold leading-4 text-white">{x.unread}</span>}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
        <section className={clsx("min-h-0 min-w-0 bg-surface", !room && "hidden lg:block")}>
          {room ? (
            <RoomView key={room.id} room={room} myTasks={myTasks} members={members} backHref="/chat" />
          ) : (
            <div className="grid h-full place-items-center text-sm text-fg-subtle">{k.select}</div>
          )}
        </section>
      </div>
    </div>
  );
}
