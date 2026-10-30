"use client";

import { CURRENCIES, type ProductDto } from "@/shared";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { formatMoneyExact, moneyInputValue, parseMoneyInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { useHydrated } from "@/lib/use-hydrated";

/** Catalog list with an inline form for adding and editing a product. */
export function ProductsManager({ products: initial, canManage, baseCurrency }: { products: ProductDto[]; canManage: boolean; baseCurrency: string }) {
  const { t, locale } = useI18n();
  const k = t.sales;
  const router = useRouter();
  const hydrated = useHydrated();
  // The API's answer applies at once; server data wins on refresh
  const [products, setProducts] = useState(initial);
  useEffect(() => setProducts(initial), [initial]);
  const [editing, setEditing] = useState<ProductDto | "new" | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pending, startTransition] = useTransition();

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const price = parseMoneyInput(String(f.get("price")));
    const tax = Number(String(f.get("tax") || "0").replace(",", "."));
    if (price === null || !Number.isFinite(tax) || tax < 0 || tax > 100) return setError(t.errors.VALIDATION_FAILED);
    const body = {
      name: String(f.get("name")),
      sku: String(f.get("sku") ?? ""),
      description: String(f.get("description") ?? ""),
      unit: String(f.get("unit") || k.defaultUnit),
      price,
      currency: String(f.get("currency")),
      taxBp: Math.round(tax * 100),
      active: f.get("active") === "on",
    };
    const current = editing;
    startTransition(async () => {
      setError(undefined);
      setNotice(undefined);
      const res = current && current !== "new" ? await api<ProductDto>(`/products/${current.id}`, "PATCH", body) : await api<ProductDto>("/products", "POST", body);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setProducts((all) => [...all.filter((p) => p.id !== res.data.id), res.data].sort((a, b) => a.name.localeCompare(b.name)));
      setEditing(null);
      router.refresh();
    });
  }

  function remove(p: ProductDto) {
    if (!window.confirm(k.confirmDeleteProduct.replace("{name}", p.name))) return;
    startTransition(async () => {
      setError(undefined);
      const res = await api<{ archived: boolean }>(`/products/${p.id}`, "DELETE");
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setProducts((all) => (res.data.archived ? all.map((x) => (x.id === p.id ? { ...x, active: false } : x)) : all.filter((x) => x.id !== p.id)));
      setNotice(res.data.archived ? k.productArchived : undefined);
      setEditing(null);
      router.refresh();
    });
  }

  const form = (p: ProductDto | null) => (
    <form onSubmit={save} className="grid gap-3 border-b border-border bg-muted/40 p-4 sm:grid-cols-6" aria-label={p ? p.name : k.newProduct}>
      <label className="field-label sm:col-span-3">
        {k.productName}
        <input name="name" required maxLength={200} defaultValue={p?.name} autoFocus className="input" />
      </label>
      <label className="field-label sm:col-span-1">
        {k.sku}
        <input name="sku" maxLength={60} defaultValue={p?.sku ?? ""} className="input" />
      </label>
      <label className="field-label sm:col-span-2">
        {k.unit}
        <input name="unit" maxLength={20} defaultValue={p?.unit ?? k.defaultUnit} className="input" />
      </label>
      <label className="field-label sm:col-span-2">
        {k.price}
        <input name="price" inputMode="decimal" required defaultValue={p ? moneyInputValue(p.price) : ""} placeholder="0.00" className="input" />
      </label>
      <label className="field-label sm:col-span-2">
        {k.currency}
        <select name="currency" defaultValue={p?.currency ?? baseCurrency} className="input">
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label sm:col-span-2">
        {k.taxPct}
        <input name="tax" inputMode="decimal" defaultValue={p ? String(p.taxBp / 100) : "0"} className="input" />
      </label>
      <label className="field-label sm:col-span-6">
        {k.lineDescription}
        <input name="description" maxLength={1000} defaultValue={p?.description ?? ""} className="input" />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-6">
        <input type="checkbox" name="active" defaultChecked={p?.active ?? true} />
        {k.activeProduct}
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-6">
        <button type="submit" disabled={pending || !hydrated} className="btn-primary">
          {p ? k.save : k.addProductButton}
        </button>
        <button type="button" onClick={() => setEditing(null)} className="btn-ghost">
          {k.cancel}
        </button>
        {p && (
          <button type="button" disabled={pending} onClick={() => remove(p)} className="btn-danger ml-auto">
            {k.delete}
          </button>
        )}
      </div>
    </form>
  );

  return (
    <section className="card" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <p className="text-sm text-fg-muted">{k.productsHint}</p>
        {canManage && (
          <button type="button" onClick={() => setEditing("new")} className="btn-primary h-8 text-xs">
            <Plus className="h-4 w-4" aria-hidden />
            {k.newProduct}
          </button>
        )}
      </div>
      {editing === "new" && form(null)}
      {notice && <p role="status" className="border-b border-border bg-success/10 px-4 py-2 text-sm text-success">{notice}</p>}
      {error && <p role="alert" className="border-b border-border bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}
      {products.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-fg-muted">{k.noProducts}</p>
      ) : (
        <ul className="divide-y divide-border">
          {products.map((p) =>
            editing !== "new" && editing?.id === p.id ? (
              <li key={p.id}>{form(p)}</li>
            ) : (
              <li key={p.id} className={clsx("flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3", !p.active && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {p.name}
                    {p.sku && <span className="ml-2 font-mono text-xs text-fg-subtle">{p.sku}</span>}
                    {!p.active && <span className="ml-2 rounded-full bg-muted px-1.5 text-[10px] text-fg-subtle">{k.archived}</span>}
                  </p>
                  {p.description && <p className="truncate text-xs text-fg-muted">{p.description}</p>}
                </div>
                <span className="tabular text-sm font-medium">
                  {formatMoneyExact(p.price, locale, p.currency)} / {p.unit}
                </span>
                <span className="w-24 text-right text-xs text-fg-muted">{p.taxBp ? `${k.taxPct}: ${p.taxBp / 100}` : k.noTax}</span>
                {canManage && (
                  <button type="button" onClick={() => setEditing(p)} className="text-xs font-medium text-accent hover:underline" aria-label={`${k.edit}: ${p.name}`}>
                    {k.edit}
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
