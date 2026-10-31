import type { Metadata } from "next";
import { ProductsManager } from "@/components/sales/ProductsManager";
import { SalesTabs } from "@/components/sales/SalesTabs";
import { getProducts, getSession } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage() {
  const [{ t }, me] = await Promise.all([getI18n(), getSession()]);
  const k = t.sales;
  const canManage = me.permissions.includes("products.manage");
  const products = await getProducts(canManage);
  return (
    <div>
      <SalesTabs invoices={me.permissions.includes("finance.view") || me.permissions.includes("invoices.manage")} />
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.products}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.productsSubtitle}</p>
      </div>
      <ProductsManager products={products} canManage={canManage} baseCurrency={me.tenant.currency} />
    </div>
  );
}
