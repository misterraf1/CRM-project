import type { Metadata } from "next";
import { MfaManager } from "@/components/auth/MfaManager";
import { CompanySecurityCard } from "@/components/settings/CompanySecurityCard";
import { getCompanySecurity, getMembers, getMySecurity, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Security" };

/** Own 2FA for everyone; the company-wide rule for those who manage members. */
export default async function SecuritySettingsPage() {
  const [{ t }, session, me] = await Promise.all([getI18n(), getSession(), getMySecurity()]);
  const manages = session.permissions.includes("members.manage");
  const [company, members] = manages ? await Promise.all([getCompanySecurity(), getMembers()]) : [null, []];
  const k = t.security;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{k.personal}</h2>
        {me.requiredByCompany && me.mfaEnabled && <p className="max-w-xl text-xs text-fg-muted">{k.requiredByCompany}</p>}
        <MfaManager scope="company" me={{ ...me, disableBlocked: me.requiredByCompany }} />
      </section>
      {company && <CompanySecurityCard requireMfa={company.requireMfa} withoutMfa={members.filter((m) => m.status === "ACTIVE" && !m.mfaEnabled).length} />}
    </div>
  );
}
