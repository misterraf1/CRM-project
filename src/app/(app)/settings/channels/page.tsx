import type { Metadata } from "next";
import { ChannelsManager } from "@/components/settings/ChannelsManager";
import { InboxSettingsCard } from "@/components/settings/InboxSettingsCard";
import { getChannels, getInboxSettings, getSession, getTemplates } from "@/lib/api";
import { hasFeature } from "@/lib/billing";

export const metadata: Metadata = { title: "Channels" };

export default async function ChannelsPage() {
  const [me, channels, templates, inboxSettings] = await Promise.all([getSession(), getChannels(), getTemplates(), getInboxSettings()]);
  return (
    <div className="space-y-5">
    <ChannelsManager
      channels={channels}
      templates={templates}
      canManage={me.permissions.includes("channels.manage")}
      canManageTemplates={me.permissions.includes("inbox.assign")}
      omnichannel={hasFeature(me, "inbox.omnichannel")}
      // Meta calls this app's public webhook route (src/app/v1/webhooks)
      webhookUrl={`${process.env.PUBLIC_API_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:3000"}/v1/webhooks/meta`}
    />
    <InboxSettingsCard settings={inboxSettings} canManage={me.permissions.includes("channels.manage")} />
    </div>
  );
}
