import type { Metadata } from "next";
import { headers } from "next/headers";
import { FormsManager } from "@/components/growth/FormsManager";
import { getForms, getMembers, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Forms" };

export default async function FormsSettingsPage() {
  const [{ t }, me, h] = await Promise.all([getI18n(), getSession(), headers()]);
  const k = t.forms;
  if (!me.permissions.includes("crm.configure")) return <p className="card p-6 text-sm text-fg-muted">{t.crmSettings.noAccess}</p>;
  const [forms, members] = await Promise.all([getForms(), getMembers()]);
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      <FormsManager forms={forms} members={members} origin={origin} />
    </div>
  );
}
