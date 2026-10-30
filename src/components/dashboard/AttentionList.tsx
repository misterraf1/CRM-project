import type { AttentionItemDto, AttentionReason } from "@/shared";
import { AlarmClock, BadgePercent, CheckCircle2, FileClock, FileText, MessageCircleWarning, PackageX, Receipt, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatMoneyExact } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { interpolate, type Locale } from "@/lib/i18n/locales";

const ICON: Record<AttentionReason, { icon: LucideIcon; className: string }> = {
  unanswered: { icon: MessageCircleWarning, className: "text-danger" },
  invoice_overdue: { icon: Receipt, className: "text-danger" },
  quote_expiring: { icon: FileClock, className: "text-warning" },
  quote_no_followup: { icon: FileText, className: "text-warning" },
  deal_stale: { icon: AlarmClock, className: "text-fg-muted" },
  order_late: { icon: PackageX, className: "text-danger" },
  approval_pending: { icon: BadgePercent, className: "text-warning" },
};

const SHOWN = 8;

/** Forgotten work, each item with its reason and a link straight to it. */
export function AttentionList({ items, t, locale }: { items: AttentionItemDto[]; t: Dictionary; locale: Locale }) {
  const k = t.dashboard.attention;
  return (
    <Card>
      <CardHeader title={k.title} meta={k.subtitle} />
      {items.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-6 text-sm text-fg-muted">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          {k.empty}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border pb-1">
          {items.slice(0, SHOWN).map((item) => {
            const { icon: Icon, className } = ICON[item.reason];
            return (
              <li key={`${item.reason}-${item.href}`}>
                <Link href={item.href} className="flex items-start gap-3 px-5 py-2.5 hover:bg-muted/60">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="block text-xs text-fg-muted">
                      {interpolate(k.reasons[item.reason], { age: item.age })}
                      {item.owner && ` · ${item.owner.name}`}
                    </span>
                  </span>
                  {item.amount && <span className="tabular shrink-0 text-xs font-medium">{formatMoneyExact(item.amount.value, locale, item.amount.currency)}</span>}
                </Link>
              </li>
            );
          })}
          {items.length > SHOWN && <li className="px-5 py-2 text-xs text-fg-subtle">{interpolate(k.more, { n: items.length - SHOWN })}</li>}
        </ul>
      )}
    </Card>
  );
}
