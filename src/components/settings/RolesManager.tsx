"use client";

import { MEMBER_ROLES, PERMISSION_GROUPS, ROLE_PERMISSIONS, type MemberRole, type Permission, type RoleDto } from "@/shared";
import clsx from "clsx";
import { Lock, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { api, type ClientResult } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

type Selection = { kind: "builtin"; role: MemberRole } | { kind: "custom"; id: string } | { kind: "new" };

/**
 * Built-in roles (fixed, shown for reference and as templates) and the company's own
 * roles with their permissions. The API enforces every rule; this screen mirrors them.
 */
export function RolesManager({ roles: initial, myPermissions, canManage }: { roles: RoleDto[]; myPermissions: Permission[]; canManage: boolean }) {
  const { t } = useI18n();
  const k = t.roles;
  const router = useRouter();
  // The API's answer applies at once; server data wins on refresh
  const [roles, setRoles] = useState(initial);
  useEffect(() => setRoles(initial), [initial]);
  const [selection, setSelection] = useState<Selection>(initial[0] ? { kind: "custom", id: initial[0].id } : { kind: "builtin", role: "MANAGER" });
  const [draft, setDraft] = useState<Set<Permission>>(new Set());
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const custom = selection.kind === "custom" ? roles.find((r) => r.id === selection.id) : undefined;
  const editing = canManage && (selection.kind === "new" || !!custom);
  const shown: readonly Permission[] = selection.kind === "builtin" ? ROLE_PERMISSIONS[selection.role] : selection.kind === "new" ? [...draft] : (custom?.permissions ?? []);

  // The checklist follows the selected role; server data wins after every save
  useEffect(() => {
    if (custom) setDraft(new Set(custom.permissions));
  }, [custom]);

  function select(next: Selection, start: readonly Permission[] = []) {
    setSelection(next);
    setError(undefined);
    setSaved(false);
    if (next.kind === "new") setDraft(new Set(start.filter((p) => p !== "billing.manage" && myPermissions.includes(p))));
  }

  function run<T>(call: () => Promise<ClientResult<T>>, apply: (data: T) => void) {
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const res = await call();
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      apply(res.data);
      router.refresh();
    });
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: String(f.get("name")).trim(), description: String(f.get("description") ?? "").trim() || null, permissions: [...draft] };
    if (selection.kind === "new") {
      run(
        () => api<RoleDto>("/roles", "POST", body),
        (role) => {
          setRoles((all) => [...all, role].sort((a, b) => a.name.localeCompare(b.name)));
          setSelection({ kind: "custom", id: role.id });
          setSaved(true);
        },
      );
    } else if (custom) {
      run(
        () => api<RoleDto>(`/roles/${custom.id}`, "PATCH", body),
        (role) => {
          setRoles((all) => all.map((r) => (r.id === role.id ? role : r)));
          setSaved(true);
        },
      );
    }
  }

  function remove() {
    if (!custom || !window.confirm(interpolate(k.confirmDelete, { name: custom.name }))) return;
    run(
      () => api(`/roles/${custom.id}`, "DELETE"),
      () => {
        setRoles((all) => all.filter((r) => r.id !== custom.id));
        setSelection({ kind: "builtin", role: "MANAGER" });
      },
    );
  }

  const toggle = (p: Permission, on: boolean) =>
    setDraft((d) => {
      const next = new Set(d);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });

  const item = (active: boolean) =>
    clsx("flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm", active ? "bg-accent-soft font-medium text-accent" : "hover:bg-muted");
  const title = selection.kind === "builtin" ? t.shell.roles[selection.role] : selection.kind === "new" ? k.newRole : (custom?.name ?? "");

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label={k.title} className="card h-fit space-y-4 p-3">
        <div>
          <p className="px-3 pb-1 text-xs font-medium text-fg-subtle">{k.builtIn}</p>
          <ul>
            {MEMBER_ROLES.map((r) => (
              <li key={r}>
                <button type="button" aria-current={selection.kind === "builtin" && selection.role === r ? "true" : undefined} onClick={() => select({ kind: "builtin", role: r })} className={item(selection.kind === "builtin" && selection.role === r)}>
                  {t.shell.roles[r]}
                  <Lock className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-label={k.fixed} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="px-3 pb-1 text-xs font-medium text-fg-subtle">{k.custom}</p>
          {roles.length === 0 && <p className="px-3 py-1 text-xs text-fg-muted">{k.noCustom}</p>}
          <ul>
            {roles.map((r) => (
              <li key={r.id}>
                <button type="button" aria-current={custom?.id === r.id ? "true" : undefined} onClick={() => select({ kind: "custom", id: r.id })} className={item(custom?.id === r.id)}>
                  <span className="truncate">{r.name}</span>
                  <span className="tabular shrink-0 text-xs text-fg-subtle">{interpolate(k.members, { n: r.members })}</span>
                </button>
              </li>
            ))}
          </ul>
          {canManage && (
            <button type="button" onClick={() => select({ kind: "new" })} className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs font-medium text-fg-muted hover:border-accent hover:text-accent">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {k.newRole}
            </button>
          )}
        </div>
      </nav>

      <form key={selection.kind === "custom" ? selection.id : selection.kind === "builtin" ? selection.role : "new"} onSubmit={save} className="card min-w-0 p-5" aria-label={title}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          {editing ? (
            <div className="grid w-full gap-3 sm:grid-cols-2">
              <label className="field-label">
                {k.name}
                <input name="name" defaultValue={custom?.name ?? ""} required minLength={2} maxLength={40} className="input" autoFocus={selection.kind === "new"} />
              </label>
              <label className="field-label">
                {k.description}
                <input name="description" defaultValue={custom?.description ?? ""} maxLength={200} className="input" />
              </label>
            </div>
          ) : (
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <ShieldCheck className="h-4 w-4 text-accent" aria-hidden />
                {title}
              </h2>
              <p className="mt-0.5 text-sm text-fg-muted">{selection.kind === "builtin" ? t.members.roleHelp[selection.role] : custom?.description}</p>
            </div>
          )}
          {selection.kind === "builtin" && canManage && (
            <button type="button" onClick={() => select({ kind: "new" }, ROLE_PERMISSIONS[selection.role])} className="btn-ghost h-8 border border-border text-xs">
              {k.copy}
            </button>
          )}
        </div>
        {selection.kind === "builtin" && <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-fg-muted">{k.builtInNote}</p>}

        <div className="mt-4 grid gap-5 md:grid-cols-2">
          {Object.entries(PERMISSION_GROUPS).map(([group, perms]) => (
            <fieldset key={group}>
              <legend className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{k.groups[group as keyof typeof k.groups]}</legend>
              <ul className="mt-2 space-y-1.5">
                {perms.map((p: Permission) => {
                  const on = editing ? draft.has(p) : shown.includes(p);
                  // Billing stays with owners; nobody grants what they don't have themselves
                  const locked = p === "billing.manage" || !myPermissions.includes(p);
                  return (
                    <li key={p}>
                      <label className={clsx("flex items-start gap-2 text-sm", editing && locked && "text-fg-subtle")}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!editing || pending || (locked && !on)}
                          onChange={(e) => toggle(p, e.target.checked)}
                          className="mt-0.5"
                          aria-describedby={editing && locked ? `why-${p}` : undefined}
                        />
                        <span>
                          {k.permissions[p]}
                          {editing && locked && (
                            <span id={`why-${p}`} className="block text-[11px] text-fg-subtle">
                              {p === "billing.manage" ? k.ownerOnly : k.notYours}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
        </div>

        {error && <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        {saved && <p role="status" className="mt-4 text-sm text-success">{k.saved}</p>}
        {editing && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <button type="submit" disabled={pending} className="btn-primary">
              {selection.kind === "new" ? k.create : k.save}
            </button>
            {custom && (
              <button type="button" disabled={pending || custom.members > 0} onClick={remove} className="btn-danger">
                {k.delete}
              </button>
            )}
            {custom && custom.members > 0 && <span className="text-xs text-fg-subtle">{interpolate(k.inUse, { n: custom.members })}</span>}
          </div>
        )}
        {!canManage && <p className="mt-5 text-xs text-fg-subtle">{k.readOnly}</p>}
      </form>
    </div>
  );
}
