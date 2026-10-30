"use client";

import type { FileDto } from "@/shared";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Documents attached to a contact or deal (contracts, measurements, photos…). */
export function RecordFiles({ path, files: initial, canUpload, canDeleteAny, meId }: { path: string; files: FileDto[]; canUpload: boolean; canDeleteAny: boolean; meId: string }) {
  const { t, locale } = useI18n();
  const k = t.crm.files;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  // The API's answer applies at once; server data wins on refresh
  const [files, setFiles] = useState(initial);
  useEffect(() => setFiles(initial), [initial]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function upload(file: File) {
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      setError(undefined);
      const res = await api<FileDto>(`${path}/files`, "POST", form);
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setFiles((all) => [res.data, ...all]);
      router.refresh();
    });
  }

  function remove(f: FileDto) {
    if (!window.confirm(k.confirmDelete.replace("{name}", f.name))) return;
    startTransition(async () => {
      setError(undefined);
      const res = await api(`/files/${f.id}`, "DELETE");
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      setFiles((all) => all.filter((x) => x.id !== f.id));
      router.refresh();
    });
  }

  return (
    <section className="card" aria-labelledby={`files-${path}`} aria-busy={pending}>
      <header className="flex items-center justify-between gap-2 px-5 pt-4">
        <h2 id={`files-${path}`} className="text-sm font-semibold">
          {k.title}
        </h2>
        {canUpload && (
          <>
            <input
              ref={input}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) upload(file);
              }}
            />
            <button type="button" disabled={pending} onClick={() => input.current?.click()} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              <Paperclip className="h-3.5 w-3.5" aria-hidden />
              {k.add}
            </button>
          </>
        )}
      </header>
      {error && <p role="alert" className="mx-5 mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {files.length === 0 ? (
        <p className="px-5 py-4 text-sm text-fg-muted">{k.empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border border-t border-border">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-5 py-2">
              <FileText className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
              <a href={`/api/v1/files/${f.id}`} download={f.name} className="min-w-0 flex-1 truncate text-sm hover:text-accent hover:underline">
                {f.name}
              </a>
              <span className="shrink-0 text-xs text-fg-subtle">
                {size(f.sizeBytes)} · {formatDate(f.createdAt, locale, "short")}
                {f.uploader && ` · ${f.uploader.name}`}
              </span>
              {(canDeleteAny || f.uploader?.id === meId) && (
                <button type="button" disabled={pending} onClick={() => remove(f)} aria-label={`${k.delete}: ${f.name}`} className="rounded p-1 text-fg-subtle hover:bg-danger/10 hover:text-danger">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
