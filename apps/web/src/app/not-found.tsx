import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="text-5xl font-semibold text-fg-subtle">404</p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          {t.common.backToDashboard}
        </Link>
      </div>
    </main>
  );
}
