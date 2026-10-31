import { LIFECYCLE_STAGES, CONTACT_SOURCES, type LifecycleStage } from "@/shared";
import clsx from "clsx";
import { BadgeCheck, Flame, LayoutGrid, List, Moon, Plus, Upload, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ContactFilters } from "@/components/crm/ContactFilters";
import { ContactTable } from "@/components/crm/ContactTable";
import { ExportMenu } from "@/components/crm/ExportMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSize } from "@/components/ui/PageSize";
import { Pagination } from "@/components/ui/Pagination";
import { StatChips } from "@/components/ui/StatChips";
import { getContacts, getFields, getMembers, getSession } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "CRM" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const PAGE_SIZES = [10, 25, 50, 100];
const isDay = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function ContactsPage({ searchParams }: Props) {
  const params = await searchParams;
  const stage = LIFECYCLE_STAGES.includes(params.stage as LifecycleStage) ? params.stage : undefined;
  const type = params.type === "person" || params.type === "company" ? params.type : undefined;
  const source = (CONTACT_SOURCES as readonly string[]).includes(params.source ?? "") ? params.source : undefined;
  // A custom field filter needs both parts
  const [field, value] = params.field && params.value ? [params.field, params.value] : [undefined, undefined];
  const level = params.level === "hot" || params.level === "warm" || params.level === "cold" ? params.level : undefined;
  const activity = params.activity === "active" || params.activity === "passive" ? params.activity : undefined;
  const filters = { q: params.q, ownerId: params.ownerId, type, source, tag: params.tag || undefined, field, value, level, activity, from: isDay(params.from), to: isDay(params.to) };
  const view = params.view === "grid" ? "grid" : "list";
  const limit = PAGE_SIZES.includes(Number(params.limit)) ? Number(params.limit) : 10;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(params.page ?? "1", 10) || 1));
  const sort = params.sort === "activity" ? "activity" : "created";
  const dir: "asc" | "desc" = params.dir === "asc" ? "asc" : "desc";

  const one = (extra: Record<string, string | undefined>) => getContacts({ ...extra, limit: "1" }).then((r) => r.total);
  const [{ t, locale }, me, list, members, fields, all, hot, customers, passive, ...byStage] = await Promise.all([
    getI18n(),
    getSession(),
    getContacts({ ...filters, stage, page: String(page), limit: String(limit), sort, dir }),
    getMembers(),
    getFields(),
    // The cards: the whole base (each a one-row query for its total)
    one({}),
    one({ level: "hot" }),
    one({ stage: "CUSTOMER" }),
    one({ activity: "passive" }),
    // The stage tabs: the current filters, per stage
    one(filters),
    ...LIFECYCLE_STAGES.map((s) => one({ ...filters, stage: s })),
  ]);
  const c = t.crm;
  const k = t.contactList;
  const num = (n: number) => formatNumber(n, locale);
  const filterFields = fields.filter((f) => f.entity !== "deal");
  const filtered = Object.values(filters).some(Boolean);
  const canFilterOwner = me.permissions.includes("contacts.manage");
  const state = { ...filters, stage, view: view === "grid" ? "grid" : undefined, limit: limit === 10 ? undefined : String(limit), sort: sort === "created" ? undefined : sort, dir: dir === "desc" ? undefined : dir };
  const href = (patch: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries({ ...state, ...patch }).filter((e): e is [string, string] => !!e[1]));
    return `/crm${qs.size ? `?${qs}` : ""}`;
  };
  const pages = Math.max(1, Math.ceil(list.total / limit));
  const first = list.total ? (page - 1) * limit + 1 : 0;
  const last = Math.min(list.total, page * limit);
  // Last activity: newest first, then oldest first, then back to the default order
  const activityDir = sort === "activity" ? dir : null;
  const activitySort = {
    dir: activityDir,
    href: href(activityDir === "desc" ? { sort: "activity", dir: "asc", page: undefined } : activityDir === "asc" ? { sort: undefined, dir: undefined, page: undefined } : { sort: "activity", dir: undefined, page: undefined }),
  };
  // The export takes exactly what the list shows (all pages)
  const exportHref = `/api/v1/exports/contacts?${new URLSearchParams(Object.entries({ ...filters, stage, lang: locale }).filter((e): e is [string, string] => !!e[1]))}`;
  const stageTabs: [string | undefined, string, number][] = [[undefined, c.all, byStage[0]!], ...LIFECYCLE_STAGES.map((s, i): [string, string, number] => [s, c.stages[s], byStage[i + 1]!])];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{c.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {c.subtitle} · {interpolate(c.total, { n: num(list.total) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {me.permissions.includes("contacts.export") && <ExportMenu href={exportHref} label={t.imports.export} hint={t.imports.exportHint} />}
          {me.permissions.includes("data.import") && (
            <Link href={type ? `/crm/import?entity=${type}` : "/crm/import"} className="btn-ghost h-10 border border-border bg-surface">
              <Upload className="h-4 w-4" aria-hidden />
              {t.imports.open}
            </Link>
          )}
          {me.permissions.includes("contacts.create") && (
            <Link href="/crm/new" className="btn-primary h-10 px-4">
              <Plus className="h-4 w-4" aria-hidden />
              {c.new}
            </Link>
          )}
        </div>
      </div>

      <StatChips
        label={t.lists.summary}
        chips={[
          { label: t.lists.contacts.all, value: num(all), href: "/crm", icon: Users, active: !filtered && !stage },
          { label: t.lists.contacts.hot, value: num(hot), href: "/crm?level=hot", icon: Flame, tone: "danger", active: level === "hot" && !stage },
          { label: t.lists.contacts.customers, value: num(customers), href: "/crm?stage=CUSTOMER", icon: BadgeCheck, tone: "success", active: stage === "CUSTOMER" && !level },
          { label: t.lists.contacts.passive, value: num(passive), href: "/crm?activity=passive", icon: Moon, tone: "warning", active: activity === "passive" && !stage },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap items-center gap-1" aria-label={c.colStage}>
          {stageTabs.map(([s, label, count]) => (
            <Link
              key={s ?? "all"}
              href={href({ stage: s, page: undefined })}
              aria-current={stage === s ? "true" : undefined}
              className={clsx(
                "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors",
                stage === s ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-muted hover:text-fg",
              )}
            >
              {label}
              <span className={clsx("tabular rounded-full px-2 text-xs font-semibold leading-5", stage === s ? "bg-accent text-accent-fg" : "bg-muted text-fg-muted")}>{num(count)}</span>
            </Link>
          ))}
        </nav>
        <div className="flex rounded-xl border border-border bg-surface p-1">
          {(
            [
              ["list", k.viewList, List],
              ["grid", k.viewGrid, LayoutGrid],
            ] as const
          ).map(([v, label, Icon]) => (
            <Link
              key={v}
              href={href({ view: v === "grid" ? "grid" : undefined })}
              aria-label={label}
              title={label}
              aria-current={view === v ? "true" : undefined}
              className={clsx("grid h-8 w-9 place-items-center rounded-lg", view === v ? "bg-accent-soft text-accent" : "text-fg-muted hover:text-fg")}
            >
              <Icon className="h-4 w-4" />
            </Link>
          ))}
        </div>
      </div>

      <ContactFilters
        values={{ q: params.q, source, ownerId: params.ownerId, tag: params.tag, from: filters.from, to: filters.to, type, level, activity, field, value }}
        keep={{ stage, view: state.view, limit: state.limit, sort: state.sort, dir: state.dir }}
        members={canFilterOwner ? members : null}
        fields={filterFields}
        resetHref={filtered ? href(Object.fromEntries(Object.keys(filters).map((x) => [x, undefined]))) : null}
      />

      <section className="card overflow-hidden">
        {list.items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={c.empty}
            hint={filtered || stage ? c.emptyHint : t.empties.contacts.hint}
            action={!filtered && !stage && me.permissions.includes("contacts.create") ? { href: "/crm/new", label: t.empties.contacts.action } : undefined}
          />
        ) : (
          <ContactTable items={list.items} view={view} permissions={me.permissions} members={members} activitySort={activitySort} />
        )}

        {list.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-4">
              <PageSize value={limit} label={k.perPage} hrefs={Object.fromEntries(PAGE_SIZES.map((n) => [n, href({ limit: n === 10 ? undefined : String(n), page: undefined })]))} />
              <span className="text-sm text-fg-muted">{interpolate(k.shown, { from: num(first), to: num(last), total: num(list.total) })}</span>
            </div>
            <Pagination page={page} pages={pages} href={(p) => href({ page: p === 1 ? undefined : String(p) })} labels={{ nav: c.title, prev: k.prev, next: k.next, page: k.pageN }} />
          </div>
        )}
      </section>
    </div>
  );
}
