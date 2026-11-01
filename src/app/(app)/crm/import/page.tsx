import { IMPORT_ENTITIES, type ImportEntity } from "@/shared";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ImportWizard } from "@/components/crm/ImportWizard";
import { getFields, getImports, getSession } from "@/lib/api";
import { hasFeature } from "@/lib/billing";
import { getAppI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Import" };

type Props = { searchParams: Promise<{ entity?: string }> };

export default async function ImportPage({ searchParams }: Props) {
  const [{ t }, me, { entity }] = await Promise.all([getAppI18n(), getSession(), searchParams]);
  const k = t.imports;
  if (!me.permissions.includes("data.import")) {
    return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;
  }
  const canDeals = hasFeature(me, "deals.pipeline");
  // Kinds this member could also create by hand
  const kinds = IMPORT_ENTITIES.filter((e) =>
    e === "deal" ? canDeals && me.permissions.includes("deals.create") : e === "product" ? me.permissions.includes("products.manage") : e === "task" ? me.permissions.includes("tasks.create") : me.permissions.includes("contacts.create"),
  );
  const [fields, history] = await Promise.all([getFields(), getImports()]);
  const initial = kinds.includes(entity as ImportEntity) ? (entity as ImportEntity) : (kinds[0] ?? "person");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link href={initial === "deal" ? "/deals" : "/crm"} className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {initial === "deal" ? t.deals.title : t.crm.back}
        </Link>
        <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      <ImportWizard fields={fields} kinds={kinds} history={history} initialEntity={initial} />
    </div>
  );
}
