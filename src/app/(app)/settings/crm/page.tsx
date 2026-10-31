import type { Metadata } from "next";
import { CurrencyManager } from "@/components/settings/CurrencyManager";
import { DocSettingsCard } from "@/components/settings/DocSettingsCard";
import { FieldsManager } from "@/components/settings/FieldsManager";
import { PipelinesManager } from "@/components/settings/PipelinesManager";
import { TemplatePicker } from "@/components/onboarding/TemplatePicker";
import { getCurrencySettings, getDocSettings, getFields, getOnboarding, getPipelines, getSession } from "@/lib/api";
import { hasFeature } from "@/lib/billing";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmSettingsPage() {
  const [{ t }, me] = await Promise.all([getI18n(), getSession()]);
  const k = t.crmSettings;
  if (!me.permissions.includes("crm.configure")) {
    return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;
  }
  const withPipelines = hasFeature(me, "deals.pipeline");
  const [fields, currencies, pipelines, docSettings, onboarding] = await Promise.all([getFields(undefined, true), getCurrencySettings(), withPipelines ? getPipelines() : [], getDocSettings(), getOnboarding()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="min-w-0 space-y-5">
          <FieldsManager fields={fields} />
          <CurrencyManager settings={currencies} />
          <DocSettingsCard settings={docSettings} />
        </div>
        <div className="min-w-0 space-y-5">
          <TemplatePicker applied={onboarding.appliedTemplates} />
          {withPipelines ? (
            <PipelinesManager pipelines={pipelines} />
          ) : (
            <section className="card p-5">
              <h2 className="text-sm font-semibold">{k.pipelines.title}</h2>
              <p className="mt-1 text-sm text-fg-muted">{k.pipelines.locked}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
