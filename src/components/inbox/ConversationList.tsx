import type { ConversationListItemDto } from "@/shared";
import clsx from "clsx";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { DemoBadge } from "@/components/ui/Card";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { formatDuration, formatRelative } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { interpolate, type Locale } from "@/lib/i18n/locales";

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
        const waitMin = c.awaitingSince ? (now.getTime() - new Date(c.awaitingSince).getTime()) / 60000 : null;
        return (
          <li key={c.id}>
            <Link
              href={href(c.id)}
              aria-current={c.id === selectedId ? "true" : undefined}
              className={clsx(
                "relative flex gap-3 rounded-lg px-2.5 py-2.5 transition-colors",
                c.id === selectedId ? "bg-accent-soft" : "hover:bg-muted/70",
              )}
            >
              {c.id === selectedId && <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-gradient-to-b from-accent to-brand-violet" aria-hidden />}
              <span className="relative h-10 w-10 shrink-0">
                <Avatar name={c.displayName || t.inbox.visitor} size="lg" />
                <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-surface">
                  <ChannelIcon channel={c.channel.type} label={t.channels.types[c.channel.type]} size="sm" />
                </span>
                {c.unreadCount > 0 && <span className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={clsx("truncate text-sm", c.unreadCount ? "font-semibold" : "font-medium")}>{c.displayName || t.inbox.visitor}</p>
                  <span className="shrink-0 text-[11px] text-fg-subtle">{c.lastMessageAt ? formatRelative(c.lastMessageAt, now, locale) : ""}</span>
                </div>
                <p className="truncate text-xs text-fg-muted">
                  {c.lastMessage?.direction === "OUTBOUND" ? `${t.inbox.you}: ` : ""}
                  {c.lastMessage?.body}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {waitMin !== null && (
                    <span className={clsx("text-[11px]", c.slaBreached ? "font-medium text-danger" : waitMin > 60 ? "font-medium text-warning" : "text-fg-subtle")}>
                      {interpolate(t.inbox.waiting, { time: formatDuration(waitMin, locale) })}
                    </span>
                  )}
                  {c.slaBreached && <span className="rounded bg-danger/10 px-1.5 text-[11px] font-medium leading-4 text-danger">{t.inbox.slaBreached}</span>}
                  {c.channel.demo && <DemoBadge label={t.channels.demoBadge} />}
                  {!c.assignee && <span className="rounded bg-danger/10 px-1.5 text-[11px] font-medium leading-4 text-danger">{t.inbox.unassigned}</span>}
                  {c.unreadCount > 0 && (
                    <span className="tabular ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-4 text-accent-fg">{c.unreadCount}</span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
