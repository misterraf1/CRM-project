import { AppShell } from "@/components/shell/AppShell";
import { getSession, getShellSummary } from "@/lib/api";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [session, summary] = await Promise.all([getSession(), getShellSummary()]);
  return (
    <AppShell session={session} summary={summary}>
      {children}
    </AppShell>
  );
}
