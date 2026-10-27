import type { Metadata } from "next";
import { AutomationsManager } from "@/components/automations/AutomationsManager";
import { planGate } from "@/components/billing/UpgradeGate";
import { getAutomations, getMembers, getPipelines, getSession } from "@/lib/api";
import { hasFeature } from "@/lib/billing";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const gate = await planGate("automations");
  if (gate) return gate;
  const [{ t }, me] = await Promise.all([getI18n(), getSession()]);
  if (!me.permissions.includes("automations.manage")) return <p className="card p-6 text-sm text-fg-muted">{t.automations.noAccess}</p>;
  const [rules, members, pipelines] = await Promise.all([
    getAutomations(),
    getMembers(),
    // Stage conditions need the pipeline (part of the same plan, but checked anyway)
    hasFeature(me, "deals.pipeline") ? getPipelines() : [],
  ]);
  return (
    <AutomationsManager
      rules={rules}
      members={members.filter((m) => m.status === "ACTIVE").map((m) => ({ id: m.id, name: m.fullName }))}
      stages={pipelines[0]?.stages ?? []}
    />
  );
}
