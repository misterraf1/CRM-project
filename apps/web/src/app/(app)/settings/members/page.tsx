import type { Metadata } from "next";
import { DepartmentsCard } from "@/components/members/DepartmentsCard";
import { MembersManager } from "@/components/members/MembersManager";
import { getDepartments, getMembers, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/locales";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const [{ t }, me, members, departments] = await Promise.all([getI18n(), getSession(), getMembers(), getDepartments()]);
  const m = t.members;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{m.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          {m.subtitle} · {interpolate(m.seats, me.subscription.seats)}
        </p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <MembersManager me={me} members={members} departments={departments} />
        </div>
        <div className="min-w-0">
          <DepartmentsCard departments={departments} canManage={me.permissions.includes("departments.manage")} />
        </div>
      </div>
    </div>
  );
}
