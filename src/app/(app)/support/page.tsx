import type { Metadata } from "next";
import Link from "next/link";
import { NewTicket } from "@/components/support/NewTicket";
import { TicketStatusBadge } from "@/components/support/TicketStatusBadge";
import { getTickets } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Support" };

export default async function SupportPage() {
  const [{ t, locale }, tickets] = await Promise.all([getI18n(), getTickets()]);
  const s = t.support;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{s.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{s.subtitle}</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="card min-w-0">
          {tickets.length === 0 ? (
            <p className="p-6 text-sm text-fg-muted">{s.empty}</p>
          ) : (
            <ul className="divide-y divide-border">
              {tickets.map((x) => (
                <li key={x.id}>
                  <Link href={`/support/${x.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-muted/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{x.subject}</p>
                      <p className="text-xs text-fg-subtle">
                        {x.author} · {formatDateTime(x.updatedAt, locale)}
                      </p>
                    </div>
                    {x.lastMessageFromStaff && x.status !== "closed" && <span className="text-[11px] font-medium text-accent">{s.answered}</span>}
                    <TicketStatusBadge status={x.status} label={s.statuses[x.status]} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-border px-5 py-2 text-[11px] text-fg-subtle">{s.visibility}</p>
        </section>
        <NewTicket />
      </div>
    </div>
  );
}
