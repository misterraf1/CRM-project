import { INTEGRATIONS } from "@/shared";
import clsx from "clsx";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ApiKeysCard } from "@/components/integrations/ApiKeysCard";
import { InboundCard } from "@/components/integrations/InboundCard";
import { WebhooksCard } from "@/components/integrations/WebhooksCard";
import { getApiKeys, getInbound, getMembers, getSession, getWebhooks } from "@/lib/api";
import { getAppI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Integrations" };

const BADGE = { live: "bg-success/10 text-success", api: "bg-accent-soft text-accent", keys: "bg-warning/10 text-warning", planned: "bg-muted text-fg-muted" } as const;

/** Incoming addresses, API keys, webhooks — and an honest catalogue of what is connected and what isn't yet. */
export default async function IntegrationsPage() {
  const [{ t }, me, h] = await Promise.all([getAppI18n(), getSession(), headers()]);
  const k = t.integrations;
  const canManage = me.permissions.includes("integrations.manage");
  const [keys, hooks, inbound, members] = canManage ? await Promise.all([getApiKeys(), getWebhooks(), getInbound(), getMembers()]) : [[], [], [], []];
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const label = { live: k.live, api: k.catalog.viaApi, keys: k.catalog.keys, planned: k.planned } as const;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      {canManage && (
        <>
          <InboundCard initial={inbound} members={members} />
          <ApiKeysCard initial={keys} origin={origin} />
          <WebhooksCard initial={hooks} />
        </>
      )}
      <section aria-labelledby="catalog-title" className="space-y-3">
        <h2 id="catalog-title" className="text-sm font-semibold">
          {k.catalog.title}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {INTEGRATIONS.map((i) => (
            <li key={i.key} className={clsx("card flex flex-col gap-2 p-4", (i.status === "planned" || i.status === "keys") && "border-dashed")}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{k.items[i.key].name}</p>
                <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", BADGE[i.status])}>{label[i.status]}</span>
              </div>
              <p className="flex-1 text-sm text-fg-muted">{k.items[i.key].desc}</p>
              {i.href && (canManage || !i.href.startsWith("#")) && (
                <Link href={i.href} className="self-start text-xs font-medium text-accent hover:underline">
                  {k.open}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
