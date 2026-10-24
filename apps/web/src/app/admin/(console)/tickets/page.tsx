import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { TicketStatusBadge } from "@/components/support/TicketStatusBadge";
import { getAdminTickets } from "@/lib/api/admin";
import { formatDateTime } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Tickets" };

const FILTERS = ["open", "in_progress", "closed"] as const;

type Props = { searchParams: Promise<{ status?: string }> };

export default async function AdminTicketsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const status = FILTERS.find((s) => s === sp.status);
  const [{ t, locale }, tickets] = await Promise.all([getI18n(), getAdminTickets(status)]);
  const k = t.admin.tickets;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
      <nav className="flex flex-wrap gap-1" aria-label={k.status}>
        {[undefined, ...FILTERS].map((s) => (
          <Link
            key={s ?? "active"}
            href={s ? `/admin/tickets?status=${s}` : "/admin/tickets"}
            aria-current={status === s ? "page" : undefined}
            className={clsx("rounded-lg px-3 py-1.5 text-xs font-medium", status === s ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-muted")}
          >
            {k.filters[s ?? "active"]}
          </Link>
        ))}
      </nav>
      <div className="card">
        {tickets.length === 0 ? (
          <p className="p-6 text-sm text-fg-muted">{k.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {tickets.map((x) => (
              <li key={x.id}>
                <Link href={`/admin/tickets/${x.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-muted/50">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{x.subject}</span>
                      {x.tenant?.prioritySupport && <span className="shrink-0 rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-accent-fg">{k.priorityPlan}</span>}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {x.tenant?.name} · {x.tenant?.plan} · {x.author}
                    </p>
                  </div>
                  <span className={clsx("text-[11px] font-medium", x.priority === "URGENT" || x.priority === "HIGH" ? "text-danger" : "text-fg-muted")}>{k.priorities[x.priority]}</span>
                  {x.status !== "closed" && <span className="text-[11px] text-fg-muted">{x.lastMessageFromStaff ? k.answered : k.waiting}</span>}
                  <TicketStatusBadge status={x.status} label={k.statuses[x.status]} />
                  <span className="w-28 text-right text-xs text-fg-subtle">{formatDateTime(x.updatedAt, locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
