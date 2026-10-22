import { CONVERSATION_STATUSES } from "@axis/shared";
import clsx from "clsx";
import { Search, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationView } from "@/components/inbox/ConversationView";
import { CustomerPanel } from "@/components/inbox/CustomerPanel";
import { LiveRefresh } from "@/components/shell/LiveRefresh";
import { getChannels, getConversation, getConversations, getDepartments, getInboxMetrics, getMembers, getTemplates } from "@/lib/api";
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
  const [{ t, locale }, list, channels, metrics] = await Promise.all([
    getI18n(),
    getConversations({ status, assignee, q: params.q }),
    getChannels(),
    getInboxMetrics(),
  ]);
  const selected = params.c
    ? await getConversation(params.c).catch((e) => {
        if (e instanceof ApiRequestError && e.status === 404) return null;
        throw e;
      })
    : null;
  const [templates, members, departments] = selected ? await Promise.all([getTemplates(), getMembers(), getDepartments()]) : [[], [], []];
  const k = t.inbox;

  const href = (patch: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries({ status, assignee, q: params.q, c: params.c, ...patch }).filter((e): e is [string, string] => !!e[1]));
    return `/inbox?${qs}`;
  };

  return (
    <div className="-my-6 -mx-4 lg:-mx-6">
      <div className="grid h-[calc(100dvh-3.5rem)] lg:grid-cols-[340px_minmax(0,1fr)_280px]">
        {/* Conversation list — hidden on mobile while a conversation is open */}
        <aside className={clsx("flex min-h-0 flex-col border-r border-border bg-surface", selected && "hidden lg:flex")}>
          <div className="space-y-2 border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-base font-semibold">{k.title}</h1>
              <div className="flex items-center gap-2">
                <LiveRefresh url="/api/v1/inbox/stream" />
                <Link href="/settings/channels" title={k.settings} aria-label={k.settings} className="grid h-7 w-7 place-items-center rounded-md text-fg-muted hover:bg-muted">
                  <Settings className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <p className="text-[11px] text-fg-subtle">
              {interpolate(k.metrics, {
                awaiting: metrics.awaiting,
                avg: metrics.avgFirstResponseMin === null ? "—" : formatDuration(metrics.avgFirstResponseMin, locale),
              })}
            </p>
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
                  className={clsx("rounded-full px-2.5 py-0.5 text-[11px] font-medium", assignee === a ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-muted")}
                >
                  {k.assignees[a]}
                </Link>
              ))}
            </nav>
            <form action="/inbox" className="relative">
              <input type="hidden" name="status" value={status} />
              <input type="hidden" name="assignee" value={assignee} />
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-fg-subtle" aria-hidden />
              <input name="q" defaultValue={params.q} placeholder={k.search} aria-label={k.search} className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-sm outline-none focus:border-accent" />
            </form>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {channels.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-fg-muted">{t.channels.none}</p>
                <Link href="/settings/channels" className="btn-primary mt-3 h-8 text-xs">
                  {k.connectChannels}
                </Link>
              </div>
            ) : (
              <ConversationList items={list} selectedId={selected?.id} href={(id) => href({ c: id })} t={t} locale={locale} />
            )}
          </div>
        </aside>

        <section className={clsx("min-h-0 min-w-0 bg-surface", !selected && "hidden lg:block")}>
          {selected ? (
            <div className="flex h-full min-h-0 flex-col">
              {/* On small screens the customer panel folds above the conversation */}
              <details className="border-b border-border lg:hidden">
                <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-fg-muted">{k.customer}</summary>
                <CustomerPanel conversation={selected} members={members} departments={departments} />
              </details>
              <div className="min-h-0 flex-1">
                <ConversationView key={selected.id} conversation={selected} templates={templates} backHref={href({ c: undefined })} />
              </div>
            </div>
          ) : (
            <div className="grid h-full place-items-center text-sm text-fg-subtle">{k.select}</div>
          )}
        </section>

        <aside className="hidden min-h-0 overflow-y-auto border-l border-border bg-surface lg:block">
          {selected && <CustomerPanel key={selected.id} conversation={selected} members={members} departments={departments} />}
        </aside>
      </div>
    </div>
  );
}
