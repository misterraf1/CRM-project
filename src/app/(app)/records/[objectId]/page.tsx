import type { CustomFieldValues, FieldDefinitionDto } from "@/shared";
import { Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { getObjects, getRecords, getSession } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getAppI18n } from "@/lib/i18n/server";
import { objectIcon } from "@/lib/object-icons";

export const metadata: Metadata = { title: "Records" };

type Props = { params: Promise<{ objectId: string }>; searchParams: Promise<{ q?: string; page?: string }> };
const LIMIT = 25;

/** A value as text in the list */
function show(f: Pick<FieldDefinitionDto, "type">, v: CustomFieldValues[string] | undefined, yes: string, locale: Parameters<typeof formatDate>[1]) {
  if (v === null || v === undefined || v === "") return "—";
  if (f.type === "date" && typeof v === "string") return formatDate(v, locale);
  if (f.type === "checkbox") return v ? yes : "—";
  if (f.type === "currency" && typeof v === "number") return (v / 100).toLocaleString(locale);
  return Array.isArray(v) ? v.join(", ") : String(v);
}

/** One custom section: its records with the first few fields as columns. */
export default async function RecordsPage({ params, searchParams }: Props) {
  const [{ objectId }, sp] = await Promise.all([params, searchParams]);
  const [{ t, locale }, me, objects] = await Promise.all([getAppI18n(), getSession(), getObjects()]);
  const object = objects.find((o) => o.id === objectId);
  if (!object) notFound();
  const k = t.objects;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const list = await getRecords(objectId, { q: sp.q, page: String(page), limit: String(LIMIT) });
  const columns = object.fields.slice(0, 4);
  const Icon = objectIcon(object.icon);
  const pages = Math.max(1, Math.ceil(list.total / LIMIT));
  const href = (p: number) => `/records/${objectId}?${new URLSearchParams(Object.entries({ q: sp.q, page: p > 1 ? String(p) : undefined }).filter((e): e is [string, string] => !!e[1]))}`;
  const canCreate = me.permissions.includes("contacts.create");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{object.name}</h1>
            <p className="text-sm text-fg-muted">{interpolate(k.records, { n: list.total })}</p>
          </div>
        </div>
        {canCreate && (
          <Link href={`/records/${objectId}/new`} className="btn-primary h-10 px-4">
            <Plus className="h-4 w-4" aria-hidden />
            {interpolate(k.newRecord, { name: object.singular })}
          </Link>
        )}
      </div>

      <form action={`/records/${objectId}`} className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-fg-subtle" aria-hidden />
        <input name="q" defaultValue={sp.q} placeholder={k.search} aria-label={k.search} className="input mt-0 h-10 pl-9" />
      </form>

      <section className="card overflow-hidden">
        {list.items.length === 0 ? (
          <EmptyState icon={Icon} title={k.none} hint={canCreate ? k.noneHint : undefined} action={canCreate && !sp.q ? { href: `/records/${objectId}/new`, label: interpolate(k.newRecord, { name: object.singular }) } : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[13px]">
                  <th scope="col" className="px-4 py-3 font-semibold">{k.title}</th>
                  {columns.map((f) => (
                    <th key={f.id} scope="col" className="px-3 py-3 font-semibold">
                      {f.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-3 font-semibold">{k.customer}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{k.updated}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.items.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 font-semibold">
                      <Link href={`/records/${objectId}/${r.id}`} className="hover:text-accent">
                        {r.title}
                      </Link>
                    </td>
                    {columns.map((f) => (
                      <td key={f.id} className="max-w-48 truncate px-3 py-3 text-[13px]">
                        {show(f, r.values[f.id], t.crm.yes, locale)}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-[13px]">
                      {r.contact ? (
                        <Link href={`/crm/${r.contact.id}`} className="hover:text-accent">
                          {r.contact.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[13px] text-fg-muted">{formatDate(r.updatedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex justify-end border-t border-border px-4 py-3">
            <Pagination page={page} pages={pages} href={href} labels={{ nav: object.name, prev: t.contactList.prev, next: t.contactList.next, page: t.contactList.pageN }} />
          </div>
        )}
      </section>
    </div>
  );
}
