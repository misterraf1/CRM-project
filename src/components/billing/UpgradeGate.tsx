import { Lock } from "lucide-react";
import Link from "next/link";
import type { MeResponse } from "@/shared";
import { getSession } from "@/lib/api";
import { FEATURE_PLAN, hasFeature } from "@/lib/billing";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

/** Shown instead of a module the current plan doesn't include. */
export function UpgradeGate({ feature, me, t }: { feature: string; me: MeResponse; t: Dictionary }) {
  const b = t.billing;
  const canManage = me.permissions.includes("billing.manage");
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Lock className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-semibold">{interpolate(b.upgradeTitle, { plan: FEATURE_PLAN[feature] ?? "PRO" })}</h1>
      <p className="mt-2 text-sm text-fg-muted">
        {b.features[feature as keyof typeof b.features]} · {interpolate(b.upgradeBody, { current: me.subscription.plan })}
      </p>
      {canManage ? (
        <Link href="/settings/billing" className="btn-primary mt-6">
          {b.seePlans}
        </Link>
      ) : (
        <p className="mt-4 text-xs text-fg-subtle">{b.ownerOnly}</p>
      )}
    </div>
  );
}

/** Server pages: returns the gate when the plan lacks `feature`, otherwise null. */
export async function planGate(feature: string) {
  const [me, { t }] = await Promise.all([getSession(), getI18n()]);
  return hasFeature(me, feature) ? null : <UpgradeGate feature={feature} me={me} t={t} />;
}
