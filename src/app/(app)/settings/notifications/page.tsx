import type { Metadata } from "next";
import { NotificationPrefs } from "@/components/settings/NotificationPrefs";
import { getNotificationPrefs } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Notifications" };

/** Personal: which notifications this member receives. */
export default async function NotificationsSettingsPage() {
  const [{ t }, prefs] = await Promise.all([getI18n(), getNotificationPrefs()]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t.notificationPrefs.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{t.notificationPrefs.subtitle}</p>
      </div>
      <NotificationPrefs muted={prefs.muted} />
    </div>
  );
}
