import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseView } from "@/components/cases/CaseView";
import { getCase, getMembers, getSession } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Case" };

type Props = { params: Promise<{ id: string }> };

export default async function CasePage({ params }: Props) {
  const { id } = await params;
  const [{ t }, me, members] = await Promise.all([getI18n(), getSession(), getMembers()]);
  if (!me.permissions.includes("cases.manage")) return <p className="card p-6 text-sm text-fg-muted">{t.cases.noAccess}</p>;
  const c = await getCase(id).catch((e) => {
    if (e instanceof ApiRequestError && e.status === 404) notFound();
    throw e;
  });
  return (
    <div className="space-y-4">
      <Link href="/cases" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.cases.back}
      </Link>
      <CaseView key={c.id} initial={c} members={members} canAssign={me.permissions.includes("tasks.assign_any")} />
    </div>
  );
}
