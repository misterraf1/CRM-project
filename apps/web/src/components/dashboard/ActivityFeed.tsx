import { CheckCircle2, Handshake, MessageCircle, MoveRight, UserPlus, Users, type LucideIcon } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import type { ActivityItem } from "@/lib/api/types";
import { formatMoney, formatRelative } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { interpolate, type Locale } from "@/lib/i18n/locales";

const ICONS: Record<ActivityItem["kind"], { icon: LucideIcon; className: string }> = {
  deal_won: { icon: Handshake, className: "text-success" },
  deal_stage: { icon: MoveRight, className: "text-accent" },
  contact_created: { icon: UserPlus, className: "text-accent" },
  task_done: { icon: CheckCircle2, className: "text-success" },
  message_in: { icon: MessageCircle, className: "text-fg-muted" },
  member_joined: { icon: Users, className: "text-fg-muted" },
};

function describe(item: ActivityItem, t: Dictionary, locale: Locale) {
  const a = t.dashboard.activity;
  switch (item.kind) {
    case "deal_won":
      return interpolate(a.deal_won, { actor: item.actor.name, subject: item.subject, amount: formatMoney(item.amount, locale) });
    case "deal_stage":
      return interpolate(a.deal_stage, { actor: item.actor.name, subject: item.subject, stage: item.stage });
    case "contact_created":
      return interpolate(a.contact_created, { actor: item.actor.name, subject: item.subject });
    case "task_done":
      return interpolate(a.task_done, { actor: item.actor.name, subject: item.subject });
    case "message_in":
      return interpolate(a.message_in, { subject: item.subject, channel: t.dashboard.channels[item.channel] });
    case "member_joined":
      return interpolate(a.member_joined, { subject: item.subject });
  }
}

export function ActivityFeed({ items, now, t, locale }: { items: ActivityItem[]; now: Date; t: Dictionary; locale: Locale }) {
  return (
    <Card>
      <CardHeader title={t.dashboard.activity.title} />
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">{t.common.none}</p>
      ) : (
        <ol className="mt-3 space-y-3 px-5 pb-4">
          {items.map((item) => {
            const { icon: Icon, className } = ICONS[item.kind];
            return (
              <li key={item.id} className="flex gap-3">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm leading-snug">{describe(item, t, locale)}</p>
                  <time dateTime={item.at} className="text-xs text-fg-subtle">
                    {formatRelative(item.at, now, locale)}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
