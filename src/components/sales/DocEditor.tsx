"use client";

import { unitPriceFor, docTotals, type DocDto, type DocKind, type ProductDto } from "@/shared";
import { Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { formatMoneyExact, moneyInputValue, parseMoneyInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { useHydrated } from "@/lib/use-hydrated";

interface Row {
  key: string;
  productId: string | null;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  price: string;
  discount: string;
  tax: string;
}

let seq = 0;
const key = () => `r${seq++}`;
const pct = (bp: number) => (bp ? String(bp / 100) : "");
/** "18" / "18,5" → basis points; empty = 0; invalid = null */
const toBp = (v: string) => {
  const n = Number(v.replace(",", ".").trim() || "0");
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : null;
};
const toQty = (v: string) => {
  const n = Number(v.replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
};

const blank = (unit: string): Row => ({ key: key(), productId: null, name: "", description: "", quantity: "1", unit, price: "", discount: "", tax: "" });

interface Props {
  kind: DocKind;
  doc?: DocDto;
  contacts: { id: string; name: string; email?: string | null }[];
  defaults: { contactId?: string; deal?: { id: string; title: string } | null };
  products: ProductDto[];
  currencies: string[];
}

/** Lines, customer, currency and dates of a quote or invoice. Totals preview with the API's arithmetic. */
export function DocEditor({ kind, doc, contacts, defaults, products, currencies }: Props) {
  const { t, locale } = useI18n();
  const k = t.sales;
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [currency, setCurrency] = useState(doc?.currency ?? currencies[0] ?? "AZN");
  const [deal, setDeal] = useState(doc ? doc.deal : (defaults.deal ?? null));
  const [rows, setRows] = useState<Row[]>(() =>
    doc
      ? doc.lines.map((l) => ({
          key: key(),
          productId: l.productId,
          name: l.name,
          description: l.description ?? "",
          quantity: String(l.quantity),
          unit: l.unit,
          price: moneyInputValue(l.unitPrice),
          discount: pct(l.discountBp),
          tax: pct(l.taxBp),
        }))
      : [blank(k.defaultUnit)],
  );

  const parsed = rows.map((r) => ({ quantity: toQty(r.quantity), unitPrice: parseMoneyInput(r.price || "0"), discountBp: toBp(r.discount), taxBp: toBp(r.tax) }));
  const valid = parsed.every((p) => p.quantity !== null && p.unitPrice !== null && p.discountBp !== null && p.taxBp !== null);
  const totals = valid ? docTotals(parsed.map((p) => ({ quantity: p.quantity!, unitPrice: p.unitPrice!, discountBp: p.discountBp!, taxBp: p.taxBp! }))) : null;
  const money = (n: number) => formatMoneyExact(n, locale, currency);
  const contactOptions = doc?.contact && !contacts.some((c) => c.id === doc.contact!.id) ? [doc.contact, ...contacts] : contacts;
  const available = products.filter((p) => p.active);

  const update = (rowKey: string, patch: Partial<Row>) =>
    setRows((all) =>
      all.map((r) => {
        if (r.key !== rowKey) return r;
        const next = { ...r, ...patch };
        // Volume pricing: a catalog line follows the tier its quantity reaches
        const p = patch.quantity !== undefined && r.productId ? products.find((x) => x.id === r.productId) : undefined;
        const qty = toQty(next.quantity);
        if (p?.priceTiers.length && qty !== null) next.price = moneyInputValue(unitPriceFor(p, qty));
        return next;
      }),
    );

  function addProduct(id: string) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    if (p.currency !== currency) setError(k.productCurrency.replace("{currency}", p.currency));
    // A bundle is one line at its own price; its contents go into the description
    const contents = p.components.length ? k.bundleIncludes.replace("{list}", p.components.map((c) => `${c.name} ×${c.quantity}`).join(", ")) : "";
    const description = [p.description, contents].filter(Boolean).join(". ").slice(0, 500);
    const row: Row = { key: key(), productId: p.id, name: p.name, description, quantity: "1", unit: p.unit, price: moneyInputValue(p.price), discount: "", tax: pct(p.taxBp) };
    // An untouched empty first row is replaced
    setRows((all) => (all.length === 1 && !all[0]!.name && !all[0]!.price ? [row] : [...all, row]));
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!valid) return setError(k.invalidLines);
    const body = {
      contactId: String(f.get("contactId")),
      dealId: deal?.id ?? null,
      currency,
      dueDate: String(f.get("dueDate") || "") || null,
      notes: String(f.get("notes") ?? ""),
      lines: rows.map((r, i) => ({
        productId: r.productId,
        name: r.name.trim(),
        description: r.description,
        quantity: parsed[i]!.quantity!,
        unit: r.unit.trim() || k.defaultUnit,
        unitPrice: parsed[i]!.unitPrice!,
        discountBp: parsed[i]!.discountBp!,
        taxBp: parsed[i]!.taxBp!,
      })),
    };
    startTransition(async () => {
      setError(undefined);
      const res = doc ? await api<DocDto>(`/docs/${doc.id}`, "PATCH", body) : await api<DocDto>("/docs", "POST", { kind, ...body });
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      router.push(`/sales/${res.data.id}`);
    });
  }

  const cell = "input mt-0 h-9";
  return (
    <form onSubmit={save} className="space-y-5" aria-busy={pending}>
      <section className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="field-label sm:col-span-2">
          {k.customer}
          <select name="contactId" required defaultValue={doc?.contact?.id ?? defaults.contactId ?? ""} className="input">
            <option value="" disabled>
              {k.chooseCustomer}
            </option>
            {contactOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          {k.currency}
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input">
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          {kind === "quote" ? k.validUntil : k.dueDate}
          <input type="date" name="dueDate" defaultValue={doc?.dueDate ? new Date(doc.dueDate).toISOString().slice(0, 10) : ""} className="input" />
        </label>
        {deal && (
          <p className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
            <span className="text-fg-muted">{k.deal}:</span>
            <span className="font-medium">{deal.title}</span>
            <button type="button" onClick={() => setDeal(null)} aria-label={k.unlinkDeal} title={k.unlinkDeal} className="rounded p-0.5 text-fg-subtle hover:bg-muted hover:text-fg">
              <X className="h-3.5 w-3.5" />
            </button>
          </p>
        )}
      </section>

      <section className="card p-5" aria-labelledby="lines-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lines-title" className="text-sm font-semibold">
            {k.lines}
          </h2>
          {available.length > 0 && (
            <select aria-label={k.addProduct} value="" onChange={(e) => addProduct(e.target.value)} className="input mt-0 h-8 w-auto max-w-full text-xs">
              <option value="">+ {k.addProduct}</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatMoneyExact(p.price, locale, p.currency)}
                </option>
              ))}
            </select>
          )}
        </div>
        <ol className="mt-3 space-y-3">
          {rows.map((r, i) => {
            const lt = totals?.lines[i];
            return (
              <li key={r.key} className="rounded-lg border border-border p-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                  <label className="col-span-2 text-xs font-medium sm:col-span-5">
                    {k.item} {i + 1}
                    <input value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} required maxLength={200} className={cell} />
                  </label>
                  <label className="text-xs font-medium sm:col-span-2">
                    {k.quantity}
                    <input value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} inputMode="decimal" required className={cell} />
                  </label>
                  <label className="text-xs font-medium sm:col-span-1">
                    {k.unit}
                    <input value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} maxLength={20} className={cell} />
                  </label>
                  <label className="text-xs font-medium sm:col-span-2">
                    {k.unitPrice}
                    <input value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} inputMode="decimal" placeholder="0.00" required className={cell} />
                  </label>
                  <label className="text-xs font-medium sm:col-span-1">
                    {k.discountPct}
                    <input value={r.discount} onChange={(e) => update(r.key, { discount: e.target.value })} inputMode="decimal" placeholder="0" className={cell} />
                  </label>
                  <label className="text-xs font-medium sm:col-span-1">
                    {k.taxPct}
                    <input value={r.tax} onChange={(e) => update(r.key, { tax: e.target.value })} inputMode="decimal" placeholder="0" className={cell} />
                  </label>
                  <label className="col-span-2 text-xs font-medium sm:col-span-10">
                    {k.lineDescription}
                    <input value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} maxLength={500} className={cell} />
                  </label>
                  <div className="col-span-2 flex items-end justify-between gap-2 sm:col-span-2 sm:justify-end">
                    <span className="tabular pb-2 text-sm font-semibold">{lt ? money(lt.total) : "—"}</span>
                    <button
                      type="button"
                      disabled={rows.length === 1}
                      onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
                      aria-label={`${k.removeLine} ${i + 1}`}
                      className="mb-1 rounded-md p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <button type="button" onClick={() => setRows((all) => [...all, blank(k.defaultUnit)])} className="btn-ghost mt-3 h-8 border border-dashed border-border text-xs">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {k.addLine}
        </button>

        <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm" aria-live="polite">
          {totals ? (
            <>
              <div className="flex justify-between text-fg-muted">
                <dt>{k.subtotal}</dt>
                <dd className="tabular">{money(totals.subtotal)}</dd>
              </div>
              {totals.discountTotal > 0 && (
                <div className="flex justify-between text-fg-muted">
                  <dt>{k.discountTotal}</dt>
                  <dd className="tabular">−{money(totals.discountTotal)}</dd>
                </div>
              )}
              {totals.taxTotal > 0 && (
                <div className="flex justify-between text-fg-muted">
                  <dt>{k.taxTotal}</dt>
                  <dd className="tabular">{money(totals.taxTotal)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
                <dt>{k.total}</dt>
                <dd className="tabular">{money(totals.total)}</dd>
              </div>
            </>
          ) : (
            <p className="text-xs text-danger">{k.invalidLines}</p>
          )}
        </dl>
      </section>

      <section className="card p-5">
        <label className="field-label">
          {k.notes}
          <textarea name="notes" rows={3} maxLength={2000} defaultValue={doc?.notes ?? ""} placeholder={k.notesPlaceholder} className="input min-h-[80px] py-2" />
        </label>
      </section>

      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending || !hydrated} className="btn-primary">
          {doc ? k.save : kind === "quote" ? k.createQuote : k.createInvoice}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-ghost">
          {k.cancel}
        </button>
      </div>
    </form>
  );
}
