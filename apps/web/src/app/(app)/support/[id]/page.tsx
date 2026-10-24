import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TicketStatusBadge } from "@/components/support/TicketStatusBadge";
import { TicketThread } from "@/components/support/TicketThread";
import { getTicket } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Support" };

type Props = { params: Promise<{ id: string }> };

export default async function TicketPage({ params }: Props) {
  const { id } = await params;
  const ticket = await getTicket(id).catch((e) => {
    if (e instanceof ApiRequestError && e.status === 404) notFound();
    throw e;
  });
  const { t } = await getI18n();
  const s = t.support;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/support" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {s.back}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{ticket.subject}</h1>
        <TicketStatusBadge status={ticket.status} label={s.statuses[ticket.status]} />
      </div>
      <TicketThread ticket={ticket} staff={false} />
    </div>
  );
}
