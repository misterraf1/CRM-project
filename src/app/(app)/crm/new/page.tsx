import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/crm/ContactForm";
import { getMembers, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "CRM" };

export default async function NewContactPage() {
  const [{ t }, me, members] = await Promise.all([getI18n(), getSession(), getMembers()]);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/crm" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.crm.back}
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{t.crm.new}</h1>
      <section className="card p-5">
        <ContactForm members={members} canAssign={me.permissions.includes("contacts.manage")} selfMemberId={me.membership.id} />
      </section>
    </div>
  );
}
