import type { CaseSummaryDto, ContactDto, CustomerValueDto, ScoreReason } from "@/shared";
import { scorePoints } from "@/shared";
import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { formatDate, formatMoney, formatMoneyExact } from "@/lib/format";
import { interpolate, type Locale } from "@/lib/i18n/locales";

/** Contact card: lead score with its reasons, what the customer has bought, renewals and open cases. */
export function CustomerValue({ contact, value, cases, canCases, t, locale }: { contact: ContactDto; value: CustomerValueDto | null; cases: CaseSummaryDto[]; canCases: boolean; t: Dictionary; locale: Locale }) {
  const v = t.value;
  return (
    <section className="card" aria-labelledby="customer-value">
      <h2 id="customer-value" className="px-5 pt-4 text-sm font-semibold">
        {v.title}
      </h2>
      {value && (
        <dl className="mt-3 grid grid-cols-2 gap-3 px-5 text-sm">
          <div>
            <dt className="text-xs text-fg-muted">{v.totalPaid}</dt>
            <dd className="tabular font-semibold">{formatMoney(value.totalPaid, locale, value.currency)}</dd>
            <dd className="text-xs text-fg-subtle">{interpolate(v.invoices, { n: value.invoices })}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">{v.lastPurchase}</dt>
            <dd className="font-medium">{value.lastPurchaseAt ? formatDate(value.lastPurchaseAt, locale, "long") : v.never}</dd>
          </div>
        </dl>
      )}
      {value && value.upcomingRenewals.length > 0 && (
        <div className="mt-3 px-5">
          <p className="text-xs text-fg-muted">{v.renewals}</p>
          <ul className="mt-1 space-y-1 text-sm">
            {value.upcomingRenewals.map((r) => (
              <li key={r.id} className="flex justify-between gap-2">
                <span className="truncate">{r.productName}</span>
                <span className={clsx("shrink-0 text-xs", r.overdue ? "text-danger" : "text-fg-muted")}>
                  {formatDate(r.dueAt, locale)} · {formatMoneyExact(r.amount, locale, r.currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {contact.scoreLevel && (
        <details className="mx-5 mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-fg-muted">
            {t.score.why} · {t.score.levels[contact.scoreLevel]} {contact.score}
          </summary>
          <ul className="mt-1 space-y-0.5 text-xs">
            {(contact.scoreReasons as ScoreReason[]).map((r) => (
              <li key={r} className="flex justify-between gap-2">
                <span>{t.score.reasons[r] ?? r}</span>
                <span className={clsx("tabular", scorePoints(r) < 0 ? "text-danger" : "text-success")}>{scorePoints(r) > 0 ? `+${scorePoints(r)}` : scorePoints(r)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {canCases && (
        <div className="mt-3 border-t border-border">
          <div className="flex items-center justify-between px-5 pt-3">
            <h3 className="text-xs font-medium text-fg-muted">{t.cases.contactCard}</h3>
            <Link href={`/cases/new?contact=${encodeURIComponent(contact.id)}&contactName=${encodeURIComponent(contact.name)}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t.cases.new}
            </Link>
          </div>
          {cases.length === 0 ? (
            <p className="px-5 py-3 text-sm text-fg-muted">{t.cases.empty}</p>
          ) : (
            <ul className="mt-1 divide-y divide-border">
              {cases.map((c) => (
                <li key={c.id}>
                  <Link href={`/cases/${c.id}`} className="flex items-center gap-2 px-5 py-2 text-sm hover:bg-muted">
                    <span className="tabular shrink-0 text-xs text-fg-subtle">{c.number}</span>
                    <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                    <span className={clsx("shrink-0 text-xs", c.overdue ? "text-danger" : "text-fg-muted")}>{t.cases.statuses[c.status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="h-4" />
    </section>
  );
}
