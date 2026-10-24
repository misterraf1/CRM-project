import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TicketStatusBadge } from "@/components/support/TicketStatusBadge";
import { TicketThread } from "@/components/support/TicketThread";
import { getAdminTicket } from "@/lib/api/admin";
import { ApiRequestError } from "@/lib/api/server";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Ticket" };

type Props = { params: Promise<{ id: string }> };

export default async function AdminTicketPage({ params }: Props) {
  const { id } = await params;
  const ticket = await getAdminTicket(id).catch((e) => {
    if (e instanceof ApiRequestError && e.status === 404) notFound();
    throw e;
  });
  const { t } = await getI18n();
  const k = t.admin.tickets;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/admin/tickets" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {k.back}
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{ticket.subject}</h1>
          <TicketStatusBadge status={ticket.status} label={k.statuses[ticket.status]} />
        </div>
        {ticket.tenant && (
          <p className="mt-1 text-sm text-fg-muted">
            <Link href={`/admin/tenants/${ticket.tenant.id}`} className="hover:text-accent">
              {ticket.tenant.name}
            </Link>{" "}
            · {ticket.tenant.plan}
            {ticket.tenant.prioritySupport && <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-accent-fg">{k.priorityPlan}</span>} · {ticket.author}
          </p>
        )}
      </div>
      <TicketThread ticket={ticket} staff />
    </div>
  );
}
