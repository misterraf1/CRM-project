import type { ConversationListItemDto } from "@/shared";
import clsx from "clsx";
import { Star } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { dayKey, formatDate, formatTime } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import type { Locale } from "@/lib/i18n/locales";

export function ConversationList({
  items,
  selectedId,
  href,
  t,
  locale,
}: {
  items: ConversationListItemDto[];
  selectedId?: string;
  href: (id: string) => string;
  t: Dictionary;
  locale: Locale;
}) {
  const now = new Date();
  if (items.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm font-semibold">{t.inbox.empty}</p>
        <p className="mt-1 text-xs text-fg-muted">{t.inbox.emptyHint}</p>
      </div>
    );
  }
  return (
    <ul className="space-y-0.5 p-1.5">
      {items.map((c) => {
        const tags = c.slaBreached || !c.assignee;
        return (
          <li key={c.id}>
            <Link
              href={href(c.id)}
              aria-current={c.id === selectedId ? "true" : undefined}
              className={clsx("relative flex gap-3 rounded-xl px-3 py-3 transition-colors", c.id === selectedId ? "bg-accent-soft" : "hover:bg-muted/70")}
            >
              {c.id === selectedId && <span className="absolute inset-y-3 left-0 w-1 rounded-r bg-gradient-to-b from-accent to-brand-violet" aria-hidden />}
              <span className="relative h-10 w-10 shrink-0">
                <Avatar name={c.displayName || t.inbox.visitor} size="lg" />
                <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-surface">
                  <ChannelIcon channel={c.channel.type} label={t.channels.types[c.channel.type]} size="sm" />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={clsx("truncate text-sm", c.unreadCount ? "font-bold" : "font-semibold")}>{c.displayName || t.inbox.visitor}</p>
                  <span className={clsx("shrink-0 text-[11px]", c.unreadCount ? "font-medium text-accent" : "text-fg-subtle")}>
                    {c.lastMessageAt ? listTime(c.lastMessageAt, now, locale, t.inbox.yesterday) : ""}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <p className={clsx("min-w-0 flex-1 truncate text-[13px]", c.unreadCount ? "text-fg" : "text-fg-muted")}>
                    {c.lastMessage?.direction === "OUTBOUND" ? `${t.inbox.you}: ` : ""}
                    {c.lastMessage?.body}
                  </p>
                  {c.starred && <Star className="h-4 w-4 shrink-0 fill-warning text-warning" aria-label={t.inbox.views.starred} />}
                  {c.unreadCount > 0 && (
                    <span className="tabular grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">{c.unreadCount}</span>
                  )}
                </div>
                {tags && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {c.slaBreached && <span className="rounded bg-danger/10 px-1.5 text-[11px] font-medium leading-4 text-danger">{t.inbox.slaBreached}</span>}
                    {!c.assignee && <span className="rounded bg-muted px-1.5 text-[11px] font-medium leading-4 text-fg-muted">{t.inbox.unassigned}</span>}
                  </div>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Today: "11:24"; yesterday: "Yesterday"; earlier: "29 okt". */
function listTime(iso: string, now: Date, locale: Locale, yesterday: string) {
  const d = dayKey(iso);
  if (d === dayKey(now)) return formatTime(iso);
  if (d === dayKey(new Date(now.getTime() - 86_400_000))) return yesterday;
  return formatDate(iso, locale, "short");
}
