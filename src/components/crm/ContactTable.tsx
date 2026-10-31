"use client";

import { CONTACT_SOURCES, LIFECYCLE_STAGES, type ContactDto, type MemberDto, type Permission } from "@/shared";
import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  CircleDashed,
  Flame,
  Star,
  Zap,
  Facebook,
  Globe,
  Instagram,
  Mail,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  PenLine,
  Phone,
  Send,
  Trash2,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { MenuItem, Popover } from "@/components/ui/Popover";
import { api } from "@/lib/api/client";
import { dayKey, formatDate, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { interpolate } from "@/lib/i18n/locales";

type ContactSource = (typeof CONTACT_SOURCES)[number];

const SOURCE_ICON: Record<ContactSource, LucideIcon> = {
  manual: PenLine,
  website: Globe,
  whatsapp: MessageCircle,
  instagram: Instagram,
  messenger: Facebook,
  facebook: Facebook,
  telegram: Send,
  ads: Megaphone,
  phone: Phone,
  referral: Users,
  other: MoreHorizontal,
};

const STATUS: Record<ContactDto["stage"], { icon: LucideIcon; className: string }> = {
  LEAD: { icon: Zap, className: "bg-accent-soft text-accent" },
  QUALIFIED: { icon: Star, className: "bg-warning/10 text-warning" },
  CUSTOMER: { icon: CheckCircle2, className: "bg-success/10 text-success" },
  CHURNED: { icon: CircleDashed, className: "bg-muted text-fg-muted" },
};

export interface SortLink {
  href: string;
  dir: "asc" | "desc" | null;
}

/** The contact list: rows (or cards) with selection, bulk changes and a menu per row. */
export function ContactTable({
  items,
  view,
  permissions,
  members,
  activitySort,
}: {
  items: ContactDto[];
  view: "list" | "grid";
  permissions: Permission[];
  members: MemberDto[];
  activitySort: SortLink;
}) {
  const { t, locale } = useI18n();
  const c = t.crm;
  const k = t.contactList;
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  // Phones get cards even in the list view: a wide table would scroll sideways
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const can = (p: Permission) => permissions.includes(p);
  const allOn = items.length > 0 && items.every((x) => selected.has(x.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Applies one change to every selected customer; reports how many didn't take
  function bulk(run: (id: string) => Promise<{ ok: boolean }>) {
    const ids = [...selected];
    startTransition(async () => {
      setError(undefined);
      const results = await Promise.all(ids.map((id) => run(id)));
      const failed = results.filter((r) => !r.ok).length;
      if (failed) setError(interpolate(k.bulkFailed, { n: failed }));
      setSelected(new Set());
      router.refresh();
    });
  }

  const now = new Date();
  const activity = (iso: string | null) => {
    if (!iso) return <span className="text-fg-subtle">—</span>;
    const d = dayKey(iso);
    const day = d === dayKey(now) ? k.today : d === dayKey(new Date(now.getTime() - 86_400_000)) ? k.yesterday : formatDate(iso, locale, "short");
    return `${day}, ${formatTime(iso)}`;
  };
  const source = (raw: string | null) => {
    const s = (CONTACT_SOURCES as readonly string[]).includes(raw ?? "") ? (raw as ContactSource) : null;
    if (!s) return <span className="text-fg-subtle">{k.noSource}</span>;
    const Icon = SOURCE_ICON[s];
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium">
        <Icon className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
        {c.sources[s]}
      </span>
    );
  };
  const owner = (x: ContactDto) =>
    x.owner ? (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={x.owner.name} size="sm" />
        <span className="truncate">{x.owner.name}</span>
      </span>
    ) : (
      <span className="text-fg-subtle">{c.unassigned}</span>
    );
  const avatar = (x: ContactDto) =>
    x.type === "company" ? (
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-fg-muted">
        <Building2 className="h-5 w-5" aria-hidden />
      </span>
    ) : (
      <Avatar name={x.name} size="lg" />
    );
  const status = (x: ContactDto) => {
    const s = STATUS[x.stage];
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", s.className)}>
          <s.icon className="h-3.5 w-3.5" aria-hidden />
          {c.stages[x.stage]}
        </span>
        {x.scoreLevel === "hot" && x.score !== null && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger" title={`${t.score.levels.hot} · ${x.score}`}>
            <Flame className="h-3.5 w-3.5" aria-hidden />
            {t.score.levels.hot}
          </span>
        )}
      </span>
    );
  };
  const rowMenu = (x: ContactDto) => (
    <Popover label={interpolate(k.rowActions, { name: x.name })} trigger={<MoreHorizontal className="h-4 w-4" />} className="grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:bg-muted hover:text-fg" panelClassName="w-52">
      {(close) => (
        <>
          <MenuItem icon={<UserRound className="h-4 w-4" />} onClick={() => (close(), router.push(`/crm/${x.id}`))}>
            {k.openCard}
          </MenuItem>
          {x.phone && (
            <MenuItem icon={<Phone className="h-4 w-4" />} onClick={() => (close(), (window.location.href = `tel:${x.phone}`))}>
              {k.call}
            </MenuItem>
          )}
          {x.email && (
            <MenuItem icon={<Mail className="h-4 w-4" />} onClick={() => (close(), (window.location.href = `mailto:${x.email}`))}>
              {k.email}
            </MenuItem>
          )}
          {can("contacts.delete") && (
            <MenuItem
              icon={<Trash2 className="h-4 w-4 text-danger" />}
              onClick={() => {
                close();
                if (!window.confirm(interpolate(k.confirmDelete, { n: 1 }))) return;
                startTransition(async () => {
                  const res = await api(`/contacts/${x.id}`, "DELETE");
                  if (!res.ok) setError(interpolate(k.bulkFailed, { n: 1 }));
                  router.refresh();
                });
              }}
            >
              <span className="text-danger">{k.bulkDelete}</span>
            </MenuItem>
          )}
        </>
      )}
    </Popover>
  );
  const check = (x: ContactDto) => (
    <input
      type="checkbox"
      checked={selected.has(x.id)}
      onChange={() => toggle(x.id)}
      aria-label={interpolate(k.selectRow, { name: x.name })}
      className="h-4 w-4 rounded border-border accent-[rgb(var(--accent))]"
    />
  );
  const cardList = () => (
    <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((x) => (
        <li key={x.id} className={clsx("rounded-2xl border bg-surface p-4 transition-shadow hover:shadow-md", selected.has(x.id) ? "border-accent ring-1 ring-accent/30" : "border-border")}>
          <div className="flex items-start gap-3">
            {check(x)}
            {avatar(x)}
            <Link href={`/crm/${x.id}`} className="min-w-0 flex-1 hover:text-accent">
              <span className="block truncate font-semibold">{x.name}</span>
              {x.companyName && <span className="block truncate text-xs text-fg-muted">{x.companyName}</span>}
            </Link>
            {rowMenu(x)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {status(x)}
            {source(x.source)}
          </div>
          <dl className="mt-3 space-y-1.5 text-sm text-fg-muted">
            {x.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <dd className="truncate">{x.phone}</dd>
              </div>
            )}
            {x.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <dd className="truncate">{x.email}</dd>
              </div>
            )}
          </dl>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs">
            {owner(x)}
            <span className="shrink-0 text-fg-subtle">{activity(x.lastActivityAt)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
  const SortIcon = activitySort.dir === "asc" ? ArrowUp : activitySort.dir === "desc" ? ArrowDown : ArrowUpDown;

  return (
    <div aria-busy={pending}>
      {selected.size > 0 && (
        <div role="region" aria-label={interpolate(k.selected, { n: selected.size })} className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft/60 px-4 py-2.5">
          <span className="text-sm font-semibold">{interpolate(k.selected, { n: selected.size })}</span>
          {can("contacts.edit") && (
            <select
              aria-label={k.bulkStage}
              value=""
              disabled={pending}
              onChange={(e) => e.target.value && bulk((id) => api(`/contacts/${id}`, "PATCH", { stage: e.target.value }))}
              className="h-8 rounded-lg border border-border bg-surface px-2 text-xs font-medium"
            >
              <option value="">{k.bulkStage}</option>
              {LIFECYCLE_STAGES.map((s) => (
                <option key={s} value={s}>
                  {c.stages[s]}
                </option>
              ))}
            </select>
          )}
          {can("contacts.manage") && (
            <select
              aria-label={k.bulkOwner}
              value=""
              disabled={pending}
              onChange={(e) => e.target.value && bulk((id) => api(`/contacts/${id}`, "PATCH", { ownerId: e.target.value === "none" ? null : e.target.value }))}
              className="h-8 rounded-lg border border-border bg-surface px-2 text-xs font-medium"
            >
              <option value="">{k.bulkOwner}</option>
              <option value="none">{c.unassigned}</option>
              {members
                .filter((m) => m.status === "ACTIVE")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
            </select>
          )}
          {can("contacts.delete") && (
            <button
              type="button"
              disabled={pending}
              onClick={() => window.confirm(interpolate(k.confirmDelete, { n: selected.size })) && bulk((id) => api(`/contacts/${id}`, "DELETE"))}
              className="btn-danger h-8 border border-danger/30 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {k.bulkDelete}
            </button>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-fg-muted hover:bg-surface">
            <X className="h-3.5 w-3.5" aria-hidden />
            {k.clearSelection}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="border-b border-border px-4 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {view === "grid" || narrow ? (
        cardList()
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[13px] text-fg">
                <th scope="col" className="w-12 py-3 pl-4">
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={() => setSelected(allOn ? new Set() : new Set(items.map((x) => x.id)))}
                    aria-label={k.selectAll}
                    className="h-4 w-4 rounded border-border accent-[rgb(var(--accent))]"
                  />
                </th>
                <th scope="col" className="px-3 py-3 font-semibold">{c.colName}</th>
                <th scope="col" className="px-3 py-3 font-semibold">{c.colContact}</th>
                <th scope="col" className="px-3 py-3 font-semibold">{k.colStatus}</th>
                <th scope="col" className="px-3 py-3 font-semibold">{k.colSource}</th>
                <th scope="col" className="px-3 py-3 font-semibold">{c.colOwner}</th>
                <th scope="col" aria-sort={activitySort.dir === "asc" ? "ascending" : activitySort.dir === "desc" ? "descending" : undefined} className="px-3 py-3 font-semibold">
                  <Link href={activitySort.href} title={k.sortActivity} className="inline-flex items-center gap-1 hover:text-accent">
                    {k.colActivity}
                    <SortIcon className={clsx("h-3.5 w-3.5", activitySort.dir ? "text-accent" : "text-fg-subtle")} aria-hidden />
                  </Link>
                </th>
                <th scope="col" className="w-14 py-3 pr-4">
                  <span className="sr-only">{t.record.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((x) => (
                <tr key={x.id} className={clsx("transition-colors", selected.has(x.id) ? "bg-accent-soft/40" : "hover:bg-muted/40")}>
                  <td className="py-3 pl-4">{check(x)}</td>
                  <td className="px-3 py-3">
                    <Link href={`/crm/${x.id}`} className="flex items-center gap-3 hover:text-accent">
                      {avatar(x)}
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate font-semibold">{x.name}</span>
                        {x.companyName && <span className="mt-0.5 block truncate text-xs text-fg-muted">{x.companyName}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-[13px]">
                    {x.phone && (
                      <span className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
                        <span className="truncate">{x.phone}</span>
                      </span>
                    )}
                    {x.email && (
                      <span className="mt-1 flex items-center gap-2 text-fg-muted">
                        <Mail className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
                        <span className="truncate">{x.email}</span>
                      </span>
                    )}
                    {!x.phone && !x.email && <span className="text-fg-subtle">—</span>}
                  </td>
                  <td className="px-3 py-3">{status(x)}</td>
                  <td className="px-3 py-3">{source(x.source)}</td>
                  <td className="max-w-40 px-3 py-3 text-[13px]">{owner(x)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-[13px] text-fg-muted">{activity(x.lastActivityAt)}</td>
                  <td className="py-3 pr-4 text-right">{rowMenu(x)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
