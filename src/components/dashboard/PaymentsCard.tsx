import type { DashboardCrmDto } from "@/shared";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatMoney } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { interpolate, type Locale } from "@/lib/i18n/locales";

/** What customers owe on issued invoices (finance only). */
export function PaymentsCard({ payments, currency, t, locale }: { payments: NonNullable<DashboardCrmDto["payments"]>; currency: string; t: Dictionary; locale: Locale }) {
  const k = t.dashboard.payments;
  return (
    <Card>
      <CardHeader title={k.title} action={{ href: "/sales?kind=invoice&status=issued", label: k.open }} />
      <dl className="grid grid-cols-2 gap-3 px-5 pb-4 pt-2">
        <div>
          <dt className="text-xs text-fg-muted">{k.due}</dt>
          <dd className="tabular text-lg font-semibold">{formatMoney(payments.due, locale, currency)}</dd>
          <dd className="text-xs text-fg-subtle">{interpolate(k.invoices, { n: payments.count })}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">{k.overdue}</dt>
          <dd className={`tabular text-lg font-semibold ${payments.overdue ? "text-danger" : ""}`}>{formatMoney(payments.overdue, locale, currency)}</dd>
          <dd className="text-xs text-fg-subtle">{interpolate(k.invoices, { n: payments.overdueCount })}</dd>
        </div>
      </dl>
    </Card>
  );
}
