import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/billing/PrintButton";
import { getDoc, getDocSettings, getSession } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { formatDate, formatMoneyExact } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Contract" };

type Props = { params: Promise<{ id: string }> };

/** The company's contract text filled in from a quote or invoice, ready to print or save as PDF. */
export default async function ContractPage({ params }: Props) {
  const { id } = await params;
  const [{ t, locale }, me, settings] = await Promise.all([getI18n(), getSession(), getDocSettings()]);
  const doc = await getDoc(id).catch((e) => {
    if (e instanceof ApiRequestError && e.status === 404) notFound();
    throw e;
  });
  const k = t.contract;
  const company = settings.legalName || me.tenant.name;
  const customer = doc.contact?.name ?? "";
  const vars: Record<string, string> = {
    company,
    customer,
    number: doc.number ?? "—",
    date: formatDate(doc.issueDate ?? doc.createdAt, locale, "long"),
    total: formatMoneyExact(doc.total, locale, doc.currency),
  };
  const text = (settings.contractTemplate ?? "").replace(/\{(company|customer|number|date|total)\}/g, (_, key: string) => vars[key] ?? "");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/sales/${doc.id}`} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {doc.number ?? t.sales.quotes}
        </Link>
        <PrintButton label={t.sales.printPdf} />
      </div>
      {!text ? (
        <p className="card p-6 text-sm text-fg-muted">{k.empty}</p>
      ) : (
        <article className="card space-y-6 bg-white p-8 text-sm leading-relaxed text-black print:border-0 print:p-0 print:shadow-none">
          <header className="text-center">
            <h1 className="text-lg font-semibold">
              {k.title} {doc.number ? `№ ${doc.number}` : ""}
            </h1>
            <p className="text-xs">{vars.date}</p>
          </header>
          <p className="whitespace-pre-wrap">{text}</p>
          <table className="w-full border-collapse text-xs">
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={i} className="border-b border-black/20">
                  <td className="py-1 pr-2">{i + 1}.</td>
                  <td className="py-1 pr-2">{l.name}</td>
                  <td className="py-1 pr-2 text-right">
                    {l.quantity} {l.unit}
                  </td>
                  <td className="py-1 text-right">{formatMoneyExact(l.total, locale, doc.currency)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="py-1 text-right font-semibold">
                  {t.sales.total}
                </td>
                <td className="py-1 text-right font-semibold">{vars.total}</td>
              </tr>
            </tbody>
          </table>
          <div className="grid grid-cols-2 gap-8 pt-8 text-xs">
            {[
              [k.seller, company, settings.taxId, settings.address, settings.bankDetails],
              [k.buyer, customer, null, null, null],
            ].map(([role, name, tax, address, bank]) => (
              <div key={role} className="space-y-1">
                <p className="font-semibold">{role}</p>
                <p>{name}</p>
                {tax && <p>{tax}</p>}
                {address && <p>{address}</p>}
                {bank && <p className="whitespace-pre-wrap">{bank}</p>}
                <p className="pt-8">______________________ {k.signature}</p>
              </div>
            ))}
          </div>
        </article>
      )}
    </div>
  );
}
