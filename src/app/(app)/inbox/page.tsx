import { CHANNEL_TYPES, CONVERSATION_STATUSES } from "@/shared";
import clsx from "clsx";
import { ArrowRight, CheckCircle2, Clock, Inbox, MessagesSquare, Search, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationView } from "@/components/inbox/ConversationView";
import { CustomerPanel } from "@/components/inbox/CustomerPanel";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { LiveRefresh } from "@/components/shell/LiveRefresh";
import { getChannels, getConversation, getConversations, getDepartments, getInboxMetrics, getMembers, getSession, getTemplates } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { formatDuration } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Inbox" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const ASSIGNEES = ["all", "me", "unassigned"] as const;

export default async function InboxPage({ searchParams }: Props) {
  const params = await searchParams;
  const status = (CONVERSATION_STATUSES as readonly string[]).includes(params.status ?? "") ? params.status! : "OPEN";
  const assignee = (ASSIGNEES as readonly string[]).includes(params.assignee ?? "") ? params.assignee! : "all";
  const [{ t, locale }, list, channels, metrics, me] = await Promise.all([
    getI18n(),
    getConversations({ status, assignee, q: params.q }),
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
  const k = t.inbox;
  const noChannels = channels.length === 0;

  const href = (patch: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries({ status, assignee, q: params.q, c: params.c, ...patch }).filter((e): e is [string, string] => !!e[1]));
    return `/inbox?${qs}`;
  };

  return (
    <div className="-mx-4 -mb-24 -mt-6 lg:-mx-6 lg:-mb-6">
      <div className={clsx("grid h-[calc(100dvh_-_7rem_-_env(safe-area-inset-bottom))] lg:h-[calc(100dvh-3.5rem)] grid-cols-[minmax(0,1fr)]", selected ? "lg:grid-cols-[340px_minmax(0,1fr)_300px]" : "lg:grid-cols-[360px_minmax(0,1fr)]")}>
        {/* Conversation list — hidden on mobile while a conversation is open */}
        <aside aria-label={k.back} className={clsx("flex min-h-0 flex-col border-r border-border bg-surface", (selected || noChannels) && "hidden lg:flex")}>
          <div className="space-y-3 border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-lg font-bold tracking-tight">{k.title}</h1>
              <div className="flex items-center gap-2">
                <LiveRefresh url="/api/v1/inbox/stream" />
                <Link href="/settings/channels" title={k.settings} aria-label={k.settings} className="grid h-7 w-7 place-items-center rounded-md text-fg-muted hover:bg-muted">
                  <Settings className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <div className={clsx("rounded-lg px-2.5 py-1.5", metrics.awaiting ? "bg-warning/10" : "bg-muted")}>
                <dt className="text-[11px] text-fg-muted">{k.awaitingLabel}</dt>
                <dd className={clsx("tabular text-base font-bold", metrics.awaiting ? "text-warning" : "text-fg")}>{metrics.awaiting}</dd>
              </div>
              <div className="rounded-lg bg-muted px-2.5 py-1.5">
                <dt className="text-[11px] text-fg-muted">{k.avgLabel}</dt>
                <dd className="tabular text-base font-bold">{metrics.avgFirstResponseMin === null ? "—" : formatDuration(metrics.avgFirstResponseMin, locale)}</dd>
              </div>
            </dl>
            <nav className="flex rounded-lg bg-muted p-0.5" aria-label={t.crm.colStage}>
              {CONVERSATION_STATUSES.map((s) => (
                <Link
                  key={s}
                  href={href({ status: s, c: undefined })}
                  aria-current={status === s ? "true" : undefined}
                  className={clsx("flex-1 rounded-md px-2 py-1 text-center text-xs font-medium", status === s ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
                >
                  {k.statuses[s]}
                </Link>
              ))}
            </nav>
            <nav className="flex gap-1" aria-label={k.assignee}>
              {ASSIGNEES.map((a) => (
                <Link
                  key={a}
                  href={href({ assignee: a, c: undefined })}
                  aria-current={assignee === a ? "true" : undefined}
                  className={clsx("rounded-full px-3 py-1 text-xs font-medium transition-colors", assignee === a ? "bg-accent-soft text-accent ring-1 ring-inset ring-accent/20" : "text-fg-muted hover:bg-muted")}
                >
                  {k.assignees[a]}
                </Link>
              ))}
            </nav>
            <form action="/inbox" className="relative">
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
              <details className="border-b border-border lg:hidden">
                <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-fg-muted">{k.customer}</summary>
                <CustomerPanel conversation={selected} members={members} departments={departments} />
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
          <aside aria-label={k.customer} className="hidden min-h-0 overflow-y-auto border-l border-border bg-surface lg:block">
            <CustomerPanel key={selected.id} conversation={selected} members={members} departments={departments} />
          </aside>
        )}
      </div>
    </div>
  );
}

/** No channel yet: what the inbox is for, and the way to switch it on. */
function Welcome({ t }: { t: Awaited<ReturnType<typeof getI18n>>["t"] }) {
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
