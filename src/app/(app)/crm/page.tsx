import { LIFECYCLE_STAGES, type LifecycleStage } from "@axis/shared";
import clsx from "clsx";
import { Building2, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StageBadge } from "@/components/crm/StageBadge";
import { Avatar } from "@/components/ui/Avatar";
import { getContacts, getMembers, getSession } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "CRM" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function ContactsPage({ searchParams }: Props) {
  const params = await searchParams;
  const stage = LIFECYCLE_STAGES.includes(params.stage as LifecycleStage) ? params.stage : undefined;
  const filters = { q: params.q, stage, ownerId: params.ownerId };
  const [{ t, locale }, me, list, members] = await Promise.all([
    getI18n(),
    getSession(),
    getContacts({ ...filters, cursor: params.cursor, limit: "25" }),
    getMembers(),
  ]);
  const c = t.crm;
  const canFilterOwner = me.permissions.includes("contacts.manage");
  const href = (patch: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries({ ...filters, ...patch }).filter((e): e is [string, string] => !!e[1]));
    return `/crm${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{c.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {c.subtitle} · {interpolate(c.total, { n: list.total })}
          </p>
        </div>
        <Link href="/crm/new" className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden />
          {c.new}
        </Link>
      </div>

      <section className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <nav className="flex flex-wrap rounded-lg bg-muted p-0.5" aria-label={c.colStage}>
            {[undefined, ...LIFECYCLE_STAGES].map((s) => (
              <Link
                key={s ?? "all"}
                href={href({ stage: s, cursor: undefined })}
                aria-current={stage === s ? "true" : undefined}
                className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", stage === s ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
              >
                {s ? c.stages[s] : c.all}
              </Link>
            ))}
          </nav>
          {/* Plain GET form: filters live in the URL, so they survive reloads and can be shared */}
          <form className="flex min-w-[220px] flex-1 flex-wrap gap-2" action="/crm">
            {stage && <input type="hidden" name="stage" value={stage} />}
            <label className="relative min-w-[180px] flex-1">
              <span className="sr-only">{c.search}</span>
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-fg-subtle" aria-hidden />
              <input name="q" defaultValue={params.q} placeholder={c.search} className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-sm outline-none focus:border-accent" />
            </label>
            {canFilterOwner && (
              <select name="ownerId" defaultValue={params.ownerId ?? ""} aria-label={c.owner} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs">
                <option value="">{c.ownerAll}</option>
                <option value="none">{c.ownerNone}</option>
                {members
                  .filter((m) => m.status === "ACTIVE")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
              </select>
            )}
            <button type="submit" aria-label={c.search} title={c.search} className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-muted">
              <Search className="h-3.5 w-3.5" aria-hidden />
            </button>
          </form>
        </div>

        {list.items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium">{c.empty}</p>
            <p className="mt-1 text-sm text-fg-muted">{c.emptyHint}</p>
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-fg-subtle">
                  <th scope="col" className="px-4 py-2 font-medium">{c.colName}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{c.colContact}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{c.colStage}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{c.colOwner}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{c.colDeals}</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">{c.colCreated}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.items.map((x) => (
                  <tr key={x.id} className="hover:bg-muted/50">
                    <td className="px-4 py-2.5">
                      <Link href={`/crm/${x.id}`} className="flex items-center gap-2.5 hover:text-accent">
                        {x.type === "company" ? (
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-fg-muted">
                            <Building2 className="h-4 w-4" aria-hidden />
                          </span>
                        ) : (
                          <Avatar name={x.name} />
                        )}
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate font-medium">{x.name}</span>
                          {x.companyName && <span className="block truncate text-xs text-fg-subtle">{x.companyName}</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 text-xs text-fg-muted">
                      <div className="truncate">{x.phone}</div>
                      <div className="truncate">{x.email}</div>
                    </td>
                    <td className="px-3">
                      <StageBadge stage={x.stage} label={c.stages[x.stage]} />
                    </td>
                    <td className="px-3 text-xs text-fg-muted">{x.owner?.name ?? <span className="text-fg-subtle">{c.unassigned}</span>}</td>
                    <td className="tabular px-3 text-right">{x.openDeals || <span className="text-fg-subtle">—</span>}</td>
                    <td className="px-4 text-right text-xs text-fg-subtle">{formatDate(x.createdAt, locale, "short")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(params.cursor || list.nextCursor) && (
          <div className="flex justify-between border-t border-border px-4 py-2.5 text-sm">
            {params.cursor ? (
              <Link href={href({ cursor: undefined })} className="font-medium text-accent hover:underline">
                {c.first}
              </Link>
            ) : (
              <span />
            )}
            {list.nextCursor && (
              <Link href={href({ cursor: list.nextCursor })} className="font-medium text-accent hover:underline">
                {c.next} →
              </Link>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
