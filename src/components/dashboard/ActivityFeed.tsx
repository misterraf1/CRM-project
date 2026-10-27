import type { ActivityDto } from "@axis/shared";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { ACTIVITY_ICONS, describeActivity } from "@/lib/activity";
import { formatRelative } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import type { Locale } from "@/lib/i18n/locales";

export function ActivityFeed({ items, now, t, locale }: { items: ActivityDto[]; now: Date; t: Dictionary; locale: Locale }) {
  return (
    <Card>
      <CardHeader title={t.dashboard.activity.title} />
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">{t.crm.noActivity}</p>
      ) : (
        <ol className="mt-3 space-y-3 px-5 pb-4">
          {items.map((item) => {
            const { icon: Icon, className } = ACTIVITY_ICONS[item.type];
            const href = item.dealId ? `/deals/${item.dealId}` : item.contactId ? `/crm/${item.contactId}` : null;
            const text = describeActivity(item, t, locale);
            return (
              <li key={item.id} className="flex gap-3">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} aria-hidden />
                <div className="min-w-0">
                  {href ? (
                    <Link href={href} className="text-sm leading-snug hover:text-accent">
                      {text}
                    </Link>
                  ) : (
                    <p className="text-sm leading-snug">{text}</p>
                  )}
                  <time dateTime={item.createdAt} className="block text-xs text-fg-subtle">
                    {formatRelative(item.createdAt, now, locale)}
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
