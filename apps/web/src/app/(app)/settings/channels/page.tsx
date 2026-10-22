import type { Metadata } from "next";
import { ChannelsManager } from "@/components/settings/ChannelsManager";
import { getChannels, getSession, getTemplates } from "@/lib/api";
import { API_URL } from "@/lib/auth/cookies";

export const metadata: Metadata = { title: "Channels" };

export default async function ChannelsPage() {
  const [me, channels, templates] = await Promise.all([getSession(), getChannels(), getTemplates()]);
  return (
    <ChannelsManager
      channels={channels}
      templates={templates}
      canManage={me.permissions.includes("channels.manage")}
      canManageTemplates={me.permissions.includes("inbox.assign")}
      // Meta calls the API directly; in production this is the public API domain
      webhookUrl={`${process.env.PUBLIC_API_URL ?? API_URL}/v1/webhooks/meta`}
    />
  );
}
