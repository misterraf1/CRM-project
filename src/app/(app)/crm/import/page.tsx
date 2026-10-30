import { IMPORT_ENTITIES, type ImportEntity } from "@/shared";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ImportWizard } from "@/components/crm/ImportWizard";
import { getFields, getImports, getSession } from "@/lib/api";
import { hasFeature } from "@/lib/billing";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Import" };

type Props = { searchParams: Promise<{ entity?: string }> };

export default async function ImportPage({ searchParams }: Props) {
  const [{ t }, me, { entity }] = await Promise.all([getI18n(), getSession(), searchParams]);
  const k = t.imports;
  if (!me.permissions.includes("data.import")) {
    return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;
  }
  const canDeals = hasFeature(me, "deals.pipeline");
  const [fields, history] = await Promise.all([getFields(), getImports()]);
  const initial = (IMPORT_ENTITIES as readonly string[]).includes(entity ?? "") && (entity !== "deal" || canDeals) ? (entity as ImportEntity) : "person";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link href={initial === "deal" ? "/deals" : "/crm"} className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {initial === "deal" ? t.deals.title : t.crm.back}
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      <ImportWizard fields={fields} canDeals={canDeals} history={history} initialEntity={initial} />
    </div>
  );
}
