"use client";

import type { FileListResponse, FileSource } from "@/shared";
import clsx from "clsx";
import { Download, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { formatBytes, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

const sourceHref = (type: FileSource, id: string | null) => (type === "task" && id ? `/tasks/${id}` : type === "chat" && id ? `/chat?r=${id}` : null);

/** File table with library upload and delete; filters live in the URL (server-rendered list). */
export function FileBrowser({ data }: { data: FileListResponse }) {
  const { t, locale } = useI18n();
  const k = t.files;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    startTransition(async () => {
      setError(undefined);
      const res = await api("/files", "POST", form);
      if (!res.ok) setError(errorMessage(t, res.code, res.details));
      router.refresh();
    });
  }

  const remove = (id: string, name: string) =>
    window.confirm(interpolate(k.confirmDelete, { name })) &&
    startTransition(async () => {
      setError(undefined);
      const res = await api(`/files/${id}`, "DELETE");
      if (!res.ok) setError(errorMessage(t, res.code, res.details));
      router.refresh();
    });

  const pct = data.storage.limitMb ? Math.min(100, (data.storage.usedMb / data.storage.limitMb) * 100) : 0;
  return (
    <div className="space-y-4" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-[220px] flex-1">
          <div className="flex justify-between text-xs">
            <span className="text-fg-muted">{k.storage}</span>
            <span className="tabular font-medium">
              {data.storage.usedMb} MB / {Math.round(data.storage.limitMb / 1024)} GB
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label={k.storage} aria-valuenow={data.storage.usedMb} aria-valuemax={data.storage.limitMb}>
            <div className={clsx("h-full rounded-full", pct >= 90 ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <input
          ref={input}
          type="file"
          className="sr-only"
          aria-label={k.upload}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        <button type="button" disabled={pending} onClick={() => input.current?.click()} className="btn-primary">
          <Upload className="h-4 w-4" aria-hidden />
          {pending ? k.uploading : k.upload}
        </button>
      </div>
      <p className="text-xs text-fg-subtle">{k.libraryHint}</p>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="card relative overflow-x-auto">
        {data.items.length === 0 ? (
          <p className="p-6 text-sm text-fg-muted">{k.empty}</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-subtle">
                <th scope="col" className="px-4 py-2 font-medium">{k.name}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.source}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.uploader}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{k.size}</th>
                <th scope="col" className="px-3 py-2 font-medium">{k.date}</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">{k.download}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((f) => {
                const href = sourceHref(f.source.type, f.source.id);
                const label = f.source.type === "library" ? k.sources.library : (f.source.title ?? (f.source.type === "chat" ? k.directChat : "—"));
                return (
                  <tr key={f.id}>
                    <td className="max-w-[280px] truncate px-4 py-2.5 font-medium">{f.name}</td>
                    <td className="max-w-[220px] truncate px-3 text-xs">
                      <span className="text-fg-subtle">{k.sources[f.source.type]}</span>
                      {f.source.type !== "library" && (
                        <>
                          {" · "}
                          {href ? (
                            <Link href={href} className="text-accent hover:underline">
                              {label}
                            </Link>
                          ) : (
                            label
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 text-xs text-fg-muted">{f.uploader?.name ?? "—"}</td>
                    <td className="tabular px-3 text-right text-xs">{formatBytes(f.sizeBytes, locale)}</td>
                    <td className="whitespace-nowrap px-3 text-xs text-fg-muted">{formatDate(f.createdAt, locale)}</td>
                    <td className="whitespace-nowrap px-4 text-right">
                      <a href={`/api/v1/files/${f.id}`} className="inline-grid h-7 w-7 place-items-center rounded-md text-fg-muted hover:bg-muted" aria-label={`${k.download}: ${f.name}`}>
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      {f.canDelete && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => remove(f.id, f.name)}
                          className="ml-1 inline-grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"
                          aria-label={`${k.delete}: ${f.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
