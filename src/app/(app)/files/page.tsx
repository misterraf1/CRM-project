import clsx from "clsx";
import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FILE_SOURCES, type FileSource } from "@/shared";
import { FileBrowser } from "@/components/files/FileBrowser";
import { getFiles } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Files" };

type Props = { searchParams: Promise<{ q?: string; source?: string }> };

export default async function FilesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const source = FILE_SOURCES.find((s) => s === sp.source) as FileSource | undefined;
  const [{ t }, data] = await Promise.all([getI18n(), getFiles({ q: sp.q, source })]);
  const k = t.files;
  const href = (s?: string) => `/files?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(s ? { source: s } : {}) })}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
        </div>
        <form action="/files" className="relative w-full sm:w-64">
          {source && <input type="hidden" name="source" value={source} />}
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input name="q" defaultValue={sp.q} placeholder={k.search} aria-label={k.search} className="input mt-0 pl-8" />
        </form>
      </div>
      <nav className="flex flex-wrap gap-1" aria-label={k.source}>
        {[undefined, ...FILE_SOURCES].map((s) => (
          <Link
            key={s ?? "all"}
            href={href(s)}
            aria-current={source === s ? "page" : undefined}
            className={clsx("rounded-lg px-3 py-1.5 text-xs font-medium", source === s ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-muted")}
          >
            {k.sources[s ?? "all"]}
          </Link>
        ))}
      </nav>
      <FileBrowser data={data} />
    </div>
  );
}
