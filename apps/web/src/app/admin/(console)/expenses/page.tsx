import type { Metadata } from "next";
import { ExpenseManager } from "@/components/admin/ExpenseManager";
import { getAdminExpenses, getAdminMe } from "@/lib/api/admin";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Expenses" };

export default async function AdminExpensesPage() {
  const [{ t }, me] = await Promise.all([getI18n(), getAdminMe()]);
  const k = t.admin.expenses;
  if (me.role !== "SUPER_ADMIN") return <p className="card p-6 text-sm text-fg-muted">{t.admin.readOnly}</p>;
  const expenses = await getAdminExpenses();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>
      <ExpenseManager expenses={expenses} today={new Date().toISOString().slice(0, 10)} />
    </div>
  );
}
