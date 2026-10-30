"use client";

import type { AdminTenantDetail } from "@/shared";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";

type Item = AdminTenantDetail["history"][number];

const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** Subscription changes, newest first: by platform staff (manual) and by the company (billing). */
export function SubscriptionHistory({ items }: { items: Item[] }) {
  const { t, locale } = useI18n();
  const k = t.admin.subscription;

  const value = (key: string, v: unknown): string => {
    if (v === null || v === undefined) return k.unlimited;
    // Period ends lie months or years ahead: always with the year
    if (typeof v === "string" && ISO.test(v)) return `${formatDate(v, locale, "long")} ${new Date(v).getUTCFullYear()}`;
    if (key === "interval" && (v === "MONTH" || v === "YEAR")) return t.admin.tenants.intervals[v];
    if (key === "status" && typeof v === "string" && v in t.admin.statuses) return t.admin.statuses[v as keyof typeof t.admin.statuses];
    if (key === "amount" && typeof v === "number") return formatMoney(v, locale);
    if (Array.isArray(v)) return v.join(", ") || "—";
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>);
      return entries.length ? entries.map(([kk, vv]) => `${k.fields[kk as keyof typeof k.fields] ?? kk} ${value(kk, vv)}`).join(", ") : k.planDefaults;
    }
    return String(v);
  };

  /** One line per changed field: "Plan: Pro → Business", "Amount: 99,00 ₼". */
  const lines = (diff: unknown) => {
    if (!diff || typeof diff !== "object") return [];
    return Object.entries(diff as Record<string, unknown>).map(([key, v]) => {
      const label = k.fields[key as keyof typeof k.fields] ?? key;
      if (v && typeof v === "object" && !Array.isArray(v) && "from" in v && "to" in v) {
        const { from, to } = v as { from: unknown; to: unknown };
        return `${label}: ${value(key, from)} → ${value(key, to)}`;
      }
      return `${label}: ${value(key, v)}`;
    });
  };

  if (!items.length) return <p className="px-5 py-4 text-sm text-fg-muted">{k.noHistory}</p>;
  return (
    <ol className="mt-2 max-h-[34rem] divide-y divide-border overflow-y-auto">
      {items.map((h) => (
        <li key={h.id} className="px-5 py-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">{k.actions[h.action as keyof typeof k.actions] ?? h.action}</span>
            <time dateTime={h.createdAt} className="text-xs text-fg-muted">
              {formatDateTime(h.createdAt, locale)}
            </time>
          </div>
          {h.actor && <p className="text-xs text-fg-subtle">{h.actor}</p>}
          <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
            {lines(h.diff).map((line, i) => (
              <li key={i} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
