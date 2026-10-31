import type { Metadata } from "next";
import { CampaignsManager } from "@/components/growth/CampaignsManager";
import { getCampaigns, getMembers, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const [{ t }, me] = await Promise.all([getI18n(), getSession()]);
  const k = t.campaigns;
  if (!me.permissions.includes("campaigns.manage")) return <p className="card p-6 text-sm text-fg-muted">{k.noAccess}</p>;
  const [campaigns, members] = await Promise.all([getCampaigns(), getMembers()]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      <CampaignsManager campaigns={campaigns} members={members} currency={me.tenant.currency} />
    </div>
  );
}
