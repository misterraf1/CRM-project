import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/crm/ContactForm";
import { getContact, getFields, getMembers, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "CRM" };

type Props = { searchParams: Promise<{ company?: string }> };

export default async function NewContactPage({ searchParams }: Props) {
  const { company: companyId } = await searchParams;
  const [{ t }, me, members, personFields, companyFields, company] = await Promise.all([
    getI18n(),
    getSession(),
    getMembers(),
    getFields("contact"),
    getFields("company"),
    // "Add person" on a company page links the new person to it
    companyId ? getContact(companyId).catch(() => null) : null,
  ]);
  if (!me.permissions.includes("contacts.create")) return <p className="card p-6 text-sm text-fg-muted">{t.errors.FORBIDDEN}</p>;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/crm" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.crm.back}
      </Link>
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t.crm.new}</h1>
      <section className="card p-5">
        <ContactForm
          members={members}
          canAssign={me.permissions.includes("contacts.manage")}
          selfMemberId={me.membership.id}
          fields={{ contact: personFields, company: companyFields }}
          defaultCompany={company?.type === "company" ? { id: company.id, name: company.name } : undefined}
        />
      </section>
    </div>
  );
}
