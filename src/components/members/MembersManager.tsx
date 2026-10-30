"use client";

import { assignableRoles, MEMBER_ROLES, type DepartmentDto, type InviteCreatedResponse, type MeResponse, type MemberDto, type MemberStatus, type RoleDto } from "@/shared";
import clsx from "clsx";
import { Check, Copy, Search, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

type Filter = "ALL" | MemberStatus;

const STATUS_STYLE: Record<MemberStatus, string> = {
  ACTIVE: "bg-success/10 text-success",
  INVITED: "bg-warning/10 text-warning",
  DISABLED: "bg-muted text-fg-subtle",
};

const select = "h-8 max-w-[11rem] rounded-lg border border-border bg-surface px-2 text-xs disabled:opacity-60";

/** One select covers both kinds of role: built-in codes as they are, custom roles as "custom:<id>". */
const CUSTOM = "custom:";
const roleValue = (x: Pick<MemberDto, "role" | "customRole">) => (x.customRole ? `${CUSTOM}${x.customRole.id}` : x.role);
const rolePatch = (value: string) => (value.startsWith(CUSTOM) ? { roleId: value.slice(CUSTOM.length) } : { role: value });

export function MembersManager({ me, members, departments, roles }: { me: MeResponse; members: MemberDto[]; departments: DepartmentDto[]; roles: RoleDto[] }) {
  const { t, locale } = useI18n();
  const m = t.members;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string; emailed: boolean } | null>(null);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  const canInvite = me.permissions.includes("members.invite");
  const canManage = me.permissions.includes("members.manage");
  const roleOptions = assignableRoles(me.membership.role);
  // Custom roles the current user may hand out: nothing beyond their own permissions (the API checks it too)
  const customOptions = roles.filter((r) => r.permissions.every((p) => me.permissions.includes(p)));
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return members.filter(
      (x) =>
        (filter === "ALL" || x.status === filter) &&
        (!q || x.fullName.toLocaleLowerCase().includes(q) || x.email.toLowerCase().includes(q)),
    );
  }, [members, filter, query]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: members.length, ACTIVE: 0, INVITED: 0, DISABLED: 0 };
    for (const x of members) c[x.status]++;
    return c;
  }, [members]);

  /** Rows the current user may change (mirrors the API rules; the API still decides). */
  const editable = (x: MemberDto) => canManage && x.id !== me.membership.id && (x.role !== "OWNER" || me.membership.role === "OWNER");

  function run(action: () => Promise<{ ok: boolean; code?: string; details?: unknown }>) {
    setError(undefined);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(errorMessage(t, res.code, res.details));
      router.refresh();
    });
  }

  function showLink(res: InviteCreatedResponse) {
    setLink({ url: `${window.location.origin}${res.invitePath}`, expiresAt: res.expiresAt, emailed: res.emailDelivery === "queued" });
    setCopied(false);
  }

  function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      email: String(form.get("email")),
      fullName: String(form.get("fullName") || "").trim() || undefined,
      ...rolePatch(String(form.get("role"))),
      departmentId: String(form.get("departmentId") || "") || null,
    };
    const target = e.currentTarget;
    run(async () => {
      const res = await api<InviteCreatedResponse>("/members/invites", "POST", body);
      if (res.ok) {
        showLink(res.data);
        setInviteOpen(false);
        target.reset();
      }
      return res;
    });
  }

  const update = (id: string, patch: Record<string, unknown>) => run(() => api<MemberDto>(`/members/${id}`, "PATCH", patch));

  const reinvite = (x: MemberDto) =>
    run(async () => {
      const res = await api<InviteCreatedResponse>("/members/invites", "POST", { email: x.email, ...rolePatch(roleValue(x)), departmentId: x.departmentId });
      if (res.ok) showLink(res.data);
      return res;
    });

  return (
    <section className={clsx("card", pending && "opacity-70")} aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="flex flex-wrap rounded-lg bg-muted p-0.5" role="tablist">
          {(["ALL", "ACTIVE", "INVITED", "DISABLED"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", filter === f ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
            >
              {f === "ALL" ? m.filterAll : m.statuses[f]} <span className="tabular text-fg-subtle">{counts[f]}</span>
            </button>
          ))}
        </div>
        <label className="relative min-w-[180px] flex-1">
          <span className="sr-only">{m.search}</span>
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-fg-subtle" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={m.search}
            className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-sm outline-none focus:border-accent"
          />
        </label>
        {canInvite && (
          <button
            type="button"
            onClick={() => setInviteOpen((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent/90"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            {m.invite}
          </button>
        )}
      </div>

      {inviteOpen && (
        <form onSubmit={invite} className="grid gap-3 border-b border-border bg-muted/40 p-4 sm:grid-cols-2">
          <label className="text-xs font-medium">
            {t.auth.email}
            <input name="email" type="email" required className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm" autoFocus />
          </label>
          <label className="text-xs font-medium">
            {t.auth.fullName} <span className="font-normal text-fg-subtle">({m.optional})</span>
            <input name="fullName" minLength={2} maxLength={100} className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm" />
          </label>
          <label className="text-xs font-medium">
            {m.role}
            <select name="role" defaultValue="EMPLOYEE" className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm">
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {t.shell.roles[r]} — {m.roleHelp[r]}
                </option>
              ))}
              {customOptions.length > 0 && (
                <optgroup label={t.roles.customGroup}>
                  {customOptions.map((r) => (
                    <option key={r.id} value={`${CUSTOM}${r.id}`}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="text-xs font-medium">
            {m.department}
            <select name="departmentId" defaultValue="" className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm">
              <option value="">{m.noDepartment}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={pending} className="h-9 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-60">
              {m.inviteSubmit}
            </button>
            <button type="button" onClick={() => setInviteOpen(false)} className="h-9 rounded-lg px-3 text-sm text-fg-muted hover:bg-muted">
              {m.cancel}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="flex items-start justify-between gap-2 border-b border-border bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
          <button type="button" onClick={() => setError(undefined)} aria-label={m.cancel}>
            <X className="h-4 w-4" />
          </button>
        </p>
      )}

      {link && (
        <div className="border-b border-border bg-accent-soft/50 px-4 py-3" role="status">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{m.linkReady}</p>
            <button type="button" onClick={() => setLink(null)} aria-label={m.cancel} className="text-fg-subtle hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 font-mono text-xs" />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link.url);
                  setCopied(true);
                } catch {
                  /* clipboard blocked: the field is selectable */
                }
              }}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium hover:bg-muted"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? m.copied : m.copy}
            </button>
          </div>
          <p className="mt-2 text-xs text-fg-muted">{interpolate(link.emailed ? m.linkHintEmailed : m.linkHint, { date: formatDate(link.expiresAt, locale, "long") })}</p>
        </div>
      )}

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-fg-subtle">
              <th scope="col" className="px-4 py-2 font-medium">{m.title}</th>
              <th scope="col" className="px-3 py-2 font-medium">{m.role}</th>
              <th scope="col" className="px-3 py-2 font-medium">{m.department}</th>
              <th scope="col" className="px-3 py-2 font-medium">{m.status}</th>
              <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((x) => {
              const can = editable(x);
              const builtIn = can ? [...new Set([x.role, ...roleOptions])] : [x.role];
              const custom = can ? customOptions : [];
              const own = x.customRole && !custom.some((r) => r.id === x.customRole!.id) ? [{ id: x.customRole.id, name: x.customRole.name }] : [];
              return (
                <tr key={x.id} className={clsx(x.status === "DISABLED" && "text-fg-subtle")}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={x.fullName} />
                      <div className="min-w-0 leading-tight">
                        <p className="truncate font-medium">
                          {x.fullName}
                          {x.id === me.membership.id && <span className="ml-1.5 text-xs font-normal text-fg-subtle">({m.you})</span>}
                        </p>
                        <p className="truncate text-xs text-fg-subtle">{x.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3">
                    <select
                      aria-label={`${m.role}: ${x.fullName}`}
                      value={roleValue(x)}
                      disabled={!can || pending || x.status === "DISABLED"}
                      onChange={(e) => update(x.id, rolePatch(e.target.value))}
                      className={select}
                    >
                      {/* A member on a custom role is stored as an employee: list that only as a choice, not as their role */}
                      {MEMBER_ROLES.filter((r) => builtIn.includes(r) && (can || !x.customRole)).map((r) => (
                        <option key={r} value={r}>
                          {t.shell.roles[r]}
                        </option>
                      ))}
                      {[...own, ...custom].length > 0 && (
                        <optgroup label={t.roles.customGroup}>
                          {[...own, ...custom].map((r) => (
                            <option key={r.id} value={`${CUSTOM}${r.id}`}>
                              {r.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </td>
                  <td className="px-3">
                    {canManage ? (
                      <select
                        aria-label={`${m.department}: ${x.fullName}`}
                        value={x.departmentId ?? ""}
                        disabled={pending}
                        onChange={(e) => update(x.id, { departmentId: e.target.value || null })}
                        className={select}
                      >
                        <option value="">{m.noDepartment}</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-fg-muted">{(x.departmentId && deptName.get(x.departmentId)) || "—"}</span>
                    )}
                  </td>
                  <td className="px-3">
                    <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[x.status])}>{m.statuses[x.status]}</span>
                    {x.status === "ACTIVE" && x.presence === "away" && <span className="ml-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">{t.shell.presence.away}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 text-right">
                    {can && x.status === "INVITED" && (
                      <>
                        <button type="button" disabled={pending} onClick={() => reinvite(x)} className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft">
                          {m.newLink}
                        </button>
                        <button type="button" disabled={pending} onClick={() => update(x.id, { status: "DISABLED" })} className="rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10">
                          {m.revoke}
                        </button>
                      </>
                    )}
                    {can && x.status === "ACTIVE" && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => window.confirm(interpolate(m.confirmDisable, { name: x.fullName })) && update(x.id, { status: "DISABLED" })}
                        className="rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                      >
                        {m.disable}
                      </button>
                    )}
                    {can && x.status === "DISABLED" && (
                      <button type="button" disabled={pending} onClick={() => update(x.id, { status: "ACTIVE" })} className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft">
                        {m.enable}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && <p className="px-4 py-8 text-center text-sm text-fg-muted">{m.empty}</p>}
      </div>
    </section>
  );
}
