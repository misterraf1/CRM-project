import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Card, CardHeader } from "@/components/ui/Card";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import type { DashboardCrmDto } from "@axis/shared";
import { formatDuration } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { interpolate, type Locale } from "@/lib/i18n/locales";

export function AwaitingInbox({ inbox, now, t, locale }: { inbox: DashboardCrmDto["inbox"]; now: Date; t: Dictionary; locale: Locale }) {
  const d = t.dashboard.inbox;
  return (
    <Card>
      <CardHeader
        title={d.title}
        meta={inbox.avgFirstResponseMin !== null ? interpolate(d.avgResponse, { time: formatDuration(inbox.avgFirstResponseMin, locale) }) : undefined}
        action={{ href: "/inbox", label: t.common.viewAll }}
      />
      {inbox.items.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-6 text-sm text-fg-muted">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          {d.empty}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border pb-1">
          {inbox.items.map((c) => {
            const waitMin = (now.getTime() - new Date(c.waitingSince).getTime()) / 60000;
            return (
              <li key={c.id}>
                <Link href={`/inbox?c=${c.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/60">
                  <ChannelIcon channel={c.channel} label={t.dashboard.channels[c.channel]} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium">{c.displayName || t.inbox.visitor}</p>
                      <span className={`tabular shrink-0 text-xs ${waitMin > 60 ? "font-medium text-warning" : "text-fg-subtle"}`}>
                        {formatDuration(waitMin, locale)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-fg-muted">{c.preview}</p>
                      {c.assignee ? (
                        <span title={c.assignee.name}>
                          <Avatar name={c.assignee.name} size="sm" />
                        </span>
                      ) : (
                        <span className="shrink-0 rounded bg-danger/10 px-1.5 text-[11px] font-medium leading-4 text-danger">
                          {d.unassigned}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
