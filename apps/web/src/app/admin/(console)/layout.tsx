import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { getAdminMe } from "@/lib/api/admin";
import { APP_NAME } from "@/lib/config";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: { template: "%s · Platform", default: "Platform" }, robots: { index: false } };

/** Platform console shell: visibly different from a company workspace (dark brand bar, "Platform" badge). */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const [me, { t }] = await Promise.all([getAdminMe(), getI18n()]);
  const k = t.admin;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur lg:px-6">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-fg text-sm font-bold text-bg">{APP_NAME[0]}</span>
        <span className="text-sm font-semibold">{APP_NAME}</span>
        <span className="rounded-full bg-fg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bg">{k.badge}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-right text-xs leading-tight sm:block">
            <span className="block font-medium">{me.fullName}</span>
            <span className="text-fg-subtle">{k.roles[me.role]}</span>
          </span>
          <LocaleSwitcher />
          <ThemeToggle />
          <form action="/admin/auth/logout" method="post">
            <button type="submit" className="grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:bg-muted hover:text-fg" aria-label={k.logout} title={k.logout}>
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:px-6">
        <aside className="min-w-0 lg:sticky lg:top-[76px] lg:self-start">
          <AdminNav superAdmin={me.role === "SUPER_ADMIN"} />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
