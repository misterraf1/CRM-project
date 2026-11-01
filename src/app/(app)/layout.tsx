import { AppShell } from "@/components/shell/AppShell";
import { getSession, getShellSummary } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n/client";
import { getAppI18n } from "@/lib/i18n/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [session, summary, { locale, t }] = await Promise.all([getSession(), getShellSummary(), getAppI18n()]);
  return (
    <I18nProvider locale={locale} t={t}>
      <AppShell session={session} summary={summary}>
        {children}
      </AppShell>
    </I18nProvider>
  );
}
