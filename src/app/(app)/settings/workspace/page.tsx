import type { Metadata } from "next";
import type { TermKey, TermLang } from "@/shared";
import { WorkspaceForm } from "@/components/settings/WorkspaceForm";
import { getObjects, getSession, getWorkspace } from "@/lib/api";
import { ObjectsManager } from "@/components/settings/ObjectsManager";
import az from "@/lib/i18n/dictionaries/az";
import en from "@/lib/i18n/dictionaries/en";
import ru from "@/lib/i18n/dictionaries/ru";
import { getAppI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Sections" };

/** The interface's own words, shown as placeholders so a blank field says what stays. */
const defaults = Object.fromEntries(
  Object.entries({ az, en, ru }).map(([lang, d]) => [
    lang,
    { contact: d.dashboard.quick.contact, contacts: d.nav.crm, newContact: d.crm.new, deal: d.dashboard.quick.deal, deals: d.nav.deals, newDeal: d.deals.new, orders: d.nav.orders, newOrder: d.orders.new },
  ]),
) as Record<TermLang, Record<TermKey, string>>;

export default async function WorkspacePage() {
  const [{ t }, me] = await Promise.all([getAppI18n(), getSession()]);
  const k = t.workspace;
  if (!me.permissions.includes("crm.configure")) return <p className="card p-6 text-sm text-fg-muted">{t.crmSettings.noAccess}</p>;
  const [workspace, objects] = await Promise.all([getWorkspace(), getObjects()]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      <WorkspaceForm initial={workspace} defaults={defaults} />
      <ObjectsManager initial={objects} />
    </div>
  );
}
