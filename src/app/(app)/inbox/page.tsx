import { CHANNEL_TYPES, CONVERSATION_STATUSES } from "@/shared";
import clsx from "clsx";
import { ArrowRight, CheckCircle2, Clock, Inbox, MessagesSquare, Search, Settings, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationView } from "@/components/inbox/ConversationView";
import { InboxFilters } from "@/components/inbox/InboxFilters";
import { CustomerPanel } from "@/components/inbox/CustomerPanel";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { LiveRefresh } from "@/components/shell/LiveRefresh";
import {
  getChannels,
  getContact,
  getContactActivities,
  getConversation,
  getConversationCounts,
  getConversations,
  getDepartments,
  getInboxMetrics,
  getMembers,
  getSession,
  getTasks,
  getTemplates,
} from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { interpolate } from "@/lib/i18n/locales";
import { getAppI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Inbox" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const ASSIGNEES = ["all", "me", "unassigned"] as const;
const VIEWS = ["all", "unread", "starred"] as const;

export default async function InboxPage({ searchParams }: Props) {
  const params = await searchParams;
  const status = [...CONVERSATION_STATUSES, "ALL"].includes(params.status ?? "") ? params.status! : "OPEN";
  const assignee = (ASSIGNEES as readonly string[]).includes(params.assignee ?? "") ? params.assignee! : "all";
  const view = (VIEWS as readonly string[]).includes(params.view ?? "") ? params.view! : "all";
  const channelType = (CHANNEL_TYPES as readonly string[]).includes(params.channel ?? "") ? params.channel : undefined;
  const filters = { status, assignee, channelType, q: params.q };
  const [{ t, locale }, list, counts, channels, metrics, me] = await Promise.all([
    getAppI18n(),
    getConversations({ ...filters, view }),
    getConversationCounts(filters),
    getChannels(),
    getInboxMetrics(),
    getSession(),
  ]);
  const selected = params.c
    ? await getConversation(params.c).catch((e) => {
        if (e instanceof ApiRequestError && e.status === 404) return null;
        throw e;
      })
    : null;
  const [templates, members, departments] = selected ? await Promise.all([getTemplates(), getMembers(), getDepartments()]) : [[], [], []];
  // The customer's CRM record beside the conversation (when linked and visible)
  const contactId = selected?.contact?.id;
  const [contact, notes, tasks] = contactId
    ? await Promise.all([
        getContact(contactId).catch(() => null),
        getContactActivities(contactId).then((a) => a.filter((x) => x.type === "note").slice(0, 5)).catch(() => []),
        getTasks({ contactId, view: "all" }).then((x) => x.filter((task) => task.status !== "DONE" && task.status !== "CANCELED")).catch(() => []),
      ])
    : [null, [], []];
  const k = t.inbox;
  const noChannels = channels.length === 0;

  const href = (patch: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries({ view, channel: channelType, status, assignee, q: params.q, c: params.c, ...patch }).filter((e): e is [string, string] => !!e[1] && e[1] !== "all"));
    return `/inbox?${qs}`;
  };

  return (
    <div className="-mx-4 -mb-24 -mt-6 lg:-mx-6 lg:-mb-6">
      <div className={clsx("grid h-[calc(100dvh_-_7rem_-_env(safe-area-inset-bottom))] lg:h-[calc(100dvh-3.5rem)] grid-cols-[minmax(0,1fr)]", selected ? "lg:grid-cols-[320px_minmax(0,1fr)] min-[1360px]:grid-cols-[320px_minmax(0,1fr)_320px]" : "lg:grid-cols-[340px_minmax(0,1fr)]")}>
        {/* Conversation list — hidden on mobile while a conversation is open */}
        <aside aria-label={k.back} className={clsx("flex min-h-0 flex-col border-r border-border bg-surface", (selected || noChannels) && "hidden lg:flex")}>
          <div className="space-y-2.5 border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-lg font-bold tracking-tight">{k.title}</h1>
              <div className="flex items-center gap-1.5">
                {metrics.awaiting > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning" title={k.awaitingLabel}>
                    <Clock className="h-3 w-3" aria-hidden />
                    {metrics.awaiting}
                  </span>
                )}
                <LiveRefresh url="/api/v1/inbox/stream" />
                <Link href="/settings/channels" title={k.settings} aria-label={k.settings} className="grid h-7 w-7 place-items-center rounded-md text-fg-muted hover:bg-muted">
                  <Settings className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <nav className="-mx-1 flex items-center gap-0.5" aria-label={k.title}>
              {VIEWS.map((v) => (
                <Link
                  key={v}
                  href={href({ view: v, c: undefined })}
                  aria-current={view === v ? "true" : undefined}
                  className={clsx(
                    "inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors",
                    view === v ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-muted hover:text-fg",
                  )}
                >
                  {k.views[v]}
                  {v === "starred" ? (
                    <Star className={clsx("h-3.5 w-3.5", view === v && "fill-current")} aria-hidden />
                  ) : null}
                  <span className={clsx("tabular rounded-full px-1.5 text-[11px] font-semibold leading-[18px]", view === v ? "bg-accent text-accent-fg" : "bg-muted text-fg-muted")}>{counts[v]}</span>
                </Link>
              ))}
            </nav>
            <InboxFilters
              values={{ channelType, status, assignee }}
              hrefFor={{
                channelType: Object.fromEntries(["", ...CHANNEL_TYPES].map((x) => [x, href({ channel: x || undefined, c: undefined })])),
                status: Object.fromEntries([...CONVERSATION_STATUSES, "ALL"].map((x) => [x, href({ status: x, c: undefined })])),
                assignee: Object.fromEntries(ASSIGNEES.map((x) => [x, href({ assignee: x, c: undefined })])),
              }}
            />
            <form action="/inbox" className="relative">
              {view !== "all" && <input type="hidden" name="view" value={view} />}
              {channelType && <input type="hidden" name="channel" value={channelType} />}
              <input type="hidden" name="status" value={status} />
              <input type="hidden" name="assignee" value={assignee} />
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-fg-subtle" aria-hidden />
              <input name="q" defaultValue={params.q} placeholder={k.search} aria-label={k.search} className="h-9 w-full rounded-lg border border-border bg-muted/50 pl-8 pr-2 text-sm outline-none focus:border-accent focus:bg-surface" />
            </form>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {noChannels ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-fg-muted">{t.channels.none}</p>
              </div>
            ) : (
              <ConversationList items={list} selectedId={selected?.id} href={(id) => href({ c: id })} t={t} locale={locale} />
            )}
          </div>
        </aside>

        <section className={clsx("min-h-0 min-w-0 bg-surface", !selected && !noChannels && "hidden lg:block")}>
          {selected ? (
            <div className="flex h-full min-h-0 flex-col">
              {/* On small screens the customer panel folds above the conversation */}
              <details className="border-b border-border min-[1360px]:hidden">
                <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-fg-muted">{k.customer}</summary>
                <CustomerPanel conversation={selected} members={members} departments={departments} contact={contact} notes={notes} tasks={tasks} />
              </details>
              <div className="min-h-0 flex-1">
                <ConversationView key={selected.id} conversation={selected} templates={templates} backHref={href({ c: undefined })} ai={me.ai} />
              </div>
            </div>
          ) : noChannels ? (
            <Welcome t={t} />
          ) : (
            <div className="grid h-full place-items-center bg-gradient-to-b from-bg to-surface p-6">
              <div className="max-w-sm text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-accent/15 to-brand-violet/15 text-accent">
                  <MessagesSquare className="h-7 w-7" aria-hidden />
                </span>
                <p className="mt-4 text-base font-semibold">{k.select}</p>
                <p className="mt-1 text-sm text-fg-muted">{k.selectHint}</p>
                <p className={clsx("mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium", metrics.awaiting ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>
                  {metrics.awaiting ? <Clock className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                  {metrics.awaiting ? interpolate(k.awaitingNow, { n: metrics.awaiting }) : k.allAnswered}
                </p>
              </div>
            </div>
          )}
        </section>

        {selected && (
          <aside aria-label={k.customer} className="hidden min-h-0 overflow-y-auto border-l border-border bg-bg/60 min-[1360px]:block">
            <CustomerPanel key={selected.id} conversation={selected} members={members} departments={departments} contact={contact} notes={notes} tasks={tasks} />
          </aside>
        )}
      </div>
    </div>
  );
}

/** No channel yet: what the inbox is for, and the way to switch it on. */
function Welcome({ t }: { t: Awaited<ReturnType<typeof getAppI18n>>["t"] }) {
  const k = t.inbox;
  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-accent-soft/40 to-surface p-6 sm:p-10">
      <div className="mx-auto max-w-2xl text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-accent to-brand-violet text-white shadow-lg shadow-accent/25 dark:text-bg">
          <Inbox className="h-8 w-8" aria-hidden />
        </span>
        <h2 className="mt-5 text-2xl font-bold tracking-tight">{k.welcome}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-fg-muted">{k.welcomeHint}</p>
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CHANNEL_TYPES.map((type) => (
            <li key={type}>
              <Link
                href="/settings/channels"
                aria-label={interpolate(k.connectOne, { channel: t.channels.types[type] })}
                className="card group flex h-full flex-col items-center gap-2 px-3 py-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
              >
                <ChannelIcon channel={type} label={t.channels.types[type]} />
                <span className="text-sm font-medium">{t.channels.types[type]}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/settings/channels" className="btn-primary mt-8 h-10 px-5">
          {k.connectChannels}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
