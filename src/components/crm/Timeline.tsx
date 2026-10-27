import type { ActivityDto } from "@axis/shared";
import { ACTIVITY_ICONS, describeActivity } from "@/lib/activity";
import { formatDate, formatRelative } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import type { Locale } from "@/lib/i18n/locales";

/** History list for a contact or a deal; notes show their full text. */
export function Timeline({ items, t, locale }: { items: ActivityDto[]; t: Dictionary; locale: Locale }) {
  if (items.length === 0) return <p className="px-5 py-6 text-sm text-fg-muted">{t.crm.noActivity}</p>;
  const now = new Date();
  return (
    <ol className="space-y-4 px-5 py-4">
      {items.map((a) => {
        const { icon: Icon, className } = ACTIVITY_ICONS[a.type];
        return (
          <li key={a.id} className="flex gap-3">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} aria-hidden />
            <div className="min-w-0 flex-1">
              {a.type === "note" ? (
                <>
                  <p className="text-xs font-medium text-fg-muted">{a.actor?.name ?? t.dashboard.activity.system}</p>
                  <p className="mt-1 whitespace-pre-wrap rounded-lg bg-warning/5 px-3 py-2 text-sm">{String(a.payload.body ?? "")}</p>
                </>
              ) : (
                <p className="text-sm leading-snug">{describeActivity(a, t, locale)}</p>
              )}
              <time dateTime={a.createdAt} title={formatDate(a.createdAt, locale, "long")} className="mt-0.5 block text-xs text-fg-subtle">
                {formatRelative(a.createdAt, now, locale)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
