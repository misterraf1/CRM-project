import { INTEGRATIONS } from "@/shared";
import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Integrations" };

/** What is connected today and what has its place reserved (added once the provider is approved). */
export default async function IntegrationsPage() {
  const { t } = await getI18n();
  const k = t.integrations;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {INTEGRATIONS.map((i) => (
          <li key={i.key} className={clsx("card flex flex-col gap-2 p-4", i.status === "planned" && "border-dashed")}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{k.items[i.key].name}</p>
              <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", i.status === "live" ? "bg-success/10 text-success" : "bg-muted text-fg-muted")}>
                {i.status === "live" ? k.live : k.planned}
              </span>
            </div>
            <p className="flex-1 text-sm text-fg-muted">{k.items[i.key].desc}</p>
            {i.href && (
              <Link href={i.href} className="self-start text-xs font-medium text-accent hover:underline">
                {k.open}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
