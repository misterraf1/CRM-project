import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { APP_NAME } from "@/lib/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-fg">{APP_NAME[0]}</span>
          <span className="text-sm font-semibold">{APP_NAME}</span>
        </div>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-8 sm:pt-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
