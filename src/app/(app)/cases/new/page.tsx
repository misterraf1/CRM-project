import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CaseForm } from "@/components/cases/CaseForm";
import { getMembers, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "New case" };

type Props = { searchParams: Promise<{ contact?: string; contactName?: string }> };

export default async function NewCasePage({ searchParams }: Props) {
  const [{ t }, me, members, sp] = await Promise.all([getI18n(), getSession(), getMembers(), searchParams]);
  const k = t.cases;
  if (!me.permissions.includes("cases.manage")) return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/cases" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {k.back}
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{k.new}</h1>
      <CaseForm
        members={members}
        meId={me.membership.id}
        canAssign={me.permissions.includes("tasks.assign_any")}
        contact={sp.contact && sp.contactName ? { id: sp.contact, name: sp.contactName } : null}
      />
    </div>
  );
}
