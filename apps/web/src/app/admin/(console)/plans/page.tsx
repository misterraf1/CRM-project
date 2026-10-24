import type { Metadata } from "next";
import { PlanEditor } from "@/components/admin/PlanEditor";
import { getAdminMe, getAdminPlans } from "@/lib/api/admin";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Plans" };

export default async function AdminPlansPage() {
  const [{ t }, me, plans] = await Promise.all([getI18n(), getAdminMe(), getAdminPlans()]);
  const k = t.admin.plans;
  const canEdit = me.role === "SUPER_ADMIN";
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
        {!canEdit && <p className="mt-2 text-xs text-fg-subtle">{t.admin.readOnly}</p>}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-3">
        {plans.map((p) => (
          <PlanEditor key={p.code} plan={p} canEdit={canEdit} />
        ))}
      </div>
    </div>
  );
}
