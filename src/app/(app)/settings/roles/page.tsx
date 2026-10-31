import type { Metadata } from "next";
import { RolesManager } from "@/components/settings/RolesManager";
import { getRoles, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Roles" };

export default async function RolesPage() {
  const [{ t }, me] = await Promise.all([getI18n(), getSession()]);
  const k = t.roles;
  if (!me.permissions.includes("members.view")) {
    return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;
  }
  const roles = await getRoles();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      <RolesManager roles={roles} myPermissions={me.permissions} canManage={me.permissions.includes("roles.manage")} />
    </div>
  );
}
