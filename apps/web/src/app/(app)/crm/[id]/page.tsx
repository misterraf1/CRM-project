import { ArrowLeft, Mail, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactDeals } from "@/components/crm/ContactDeals";
import { ContactForm } from "@/components/crm/ContactForm";
import { DeleteButton } from "@/components/crm/DeleteButton";
import { NoteComposer } from "@/components/crm/NoteComposer";
import { StageBadge } from "@/components/crm/StageBadge";
import { Timeline } from "@/components/crm/Timeline";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskQuickAdd } from "@/components/tasks/TaskQuickAdd";
import { getContact, getContactActivities, getConversations, getMembers, getPipelines, getSession, getTasks } from "@/lib/api";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { formatRelative } from "@/lib/format";
import { ApiRequestError } from "@/lib/api/server";
import { formatMoney } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "CRM" };

type Props = { params: Promise<{ id: string }> };

export default async function ContactPage({ params }: Props) {
  const { id } = await params;
  const [{ t, locale }, me, members, pipelines] = await Promise.all([getI18n(), getSession(), getMembers(), getPipelines()]);
  const [contact, activities, tasks, conversations] = await Promise.all([
    getContact(id),
    getContactActivities(id),
    getTasks({ contactId: id, view: "all" }),
    getConversations({ contactId: id, status: "ALL" }),
  ]).catch((e) => {
    if (e instanceof ApiRequestError && e.status === 404) notFound();
    throw e;
  });
  const c = t.crm;
  const openValue = contact.deals.filter((d) => !d.closedAt).reduce((a, d) => a + d.amount, 0);

  return (
    <div className="space-y-5">
      <Link href="/crm" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {c.back}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{contact.name}</h1>
            <StageBadge stage={contact.stage} label={c.stages[contact.stage]} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
            {contact.companyName && <span>{contact.companyName}</span>}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1 hover:text-accent">
                <Phone className="h-3.5 w-3.5" aria-hidden />
                {contact.phone}
              </a>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 hover:text-accent">
                <Mail className="h-3.5 w-3.5" aria-hidden />
                {contact.email}
              </a>
            )}
            {openValue > 0 && <span>{interpolate(t.deals.count, { n: contact.openDeals })} · {formatMoney(openValue, locale)}</span>}
          </div>
        </div>
        {me.permissions.includes("contacts.delete") && (
          <DeleteButton path={`/contacts/${contact.id}`} confirmText={interpolate(c.confirmDelete, { name: contact.name })} label={c.delete} redirectTo="/crm" />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="min-w-0 space-y-5">
          <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold">{c.details}</h2>
            <ContactForm contact={contact} members={members} canAssign={me.permissions.includes("contacts.manage")} selfMemberId={me.membership.id} />
          </section>
          {conversations.length > 0 && (
            <section className="card">
              <h2 className="px-5 pt-4 text-sm font-semibold">{t.inbox.title}</h2>
              <ul className="mt-2 divide-y divide-border border-t border-border">
                {conversations.map((cv) => (
                  <li key={cv.id}>
                    <Link href={`/inbox?status=${cv.status}&assignee=all&c=${cv.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/50">
                      <ChannelIcon channel={cv.channel.type} label={t.channels.types[cv.channel.type]} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm">{cv.lastMessage?.body ?? cv.channel.name}</span>
                      <span className="shrink-0 text-xs text-fg-subtle">
                        {t.inbox.statuses[cv.status]}
                        {cv.lastMessageAt && ` · ${formatRelative(cv.lastMessageAt, new Date(), locale)}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="card">
            <h2 className="px-5 pt-4 text-sm font-semibold">{t.tasks.reminders}</h2>
            <div className="mt-2 border-t border-border">
              <TaskList tasks={tasks} compact />
            </div>
            <div className="border-t border-border p-3">
              <TaskQuickAdd members={members} selfMemberId={me.membership.id} defaults={{ contactId: contact.id }} compact />
            </div>
          </section>
          {pipelines[0] && <ContactDeals contactId={contact.id} deals={contact.deals} pipeline={pipelines[0]} />}
        </div>
        <section className="card min-w-0">
          <h2 className="px-5 pt-4 text-sm font-semibold">{c.timeline}</h2>
          <div className="mt-3 border-t border-border">
            <NoteComposer contactId={contact.id} />
            <Timeline items={activities} t={t} locale={locale} />
          </div>
        </section>
      </div>
    </div>
  );
}
