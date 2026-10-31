import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { MfaManager } from "@/components/auth/MfaManager";
import { getMySecurity } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "2FA" };

/** Where the company requires 2FA: the only page open until it's set up. */
export default async function SecuritySetupPage() {
  const [{ t }, me] = await Promise.all([getI18n(), getMySecurity()]);
  if (me.mfaEnabled || !me.requiredByCompany) redirect("/dashboard");
  return (
    <AuthFrame>
      <h1 className="text-xl font-semibold tracking-tight">{t.security.setupTitle}</h1>
      <p className="mb-5 mt-1 text-sm text-fg-muted">{t.security.setupHint}</p>
      {/* A fresh session (refresh) carries the finished setup */}
      <MfaManager scope="company" me={{ ...me, disableBlocked: true }} continueHref="/auth/refresh?next=/dashboard" />
      <form action="/auth/logout" method="post" className="mt-6 text-center">
        <button type="submit" className="text-sm text-fg-muted hover:text-fg">
          {t.admin.logout}
        </button>
      </form>
    </AuthFrame>
  );
}
