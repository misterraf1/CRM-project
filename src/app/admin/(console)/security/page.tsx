import type { Metadata } from "next";
import { MfaManager } from "@/components/auth/MfaManager";
import { getAdminMe } from "@/lib/api/admin";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Security" };

export default async function AdminSecurityPage() {
  const [{ t }, me] = await Promise.all([getI18n(), getAdminMe()]);
  const k = t.admin.security;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      {me.mfaRequired && !me.mfaEnabled && <p className="max-w-xl rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">{k.required}</p>}
      <MfaManager scope="admin" me={{ mfaEnabled: me.mfaEnabled, recoveryCodesLeft: me.recoveryCodesLeft, disableBlocked: me.mfaRequired }} />
    </div>
  );
}
