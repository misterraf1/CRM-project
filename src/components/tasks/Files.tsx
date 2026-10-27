"use client";

import type { FileDto } from "@axis/shared";
import { Download, Paperclip, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { formatBytes } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

const MAX_BYTES = 10 * 1024 * 1024;

export function Files({ taskId, items, canEdit, selfMemberId }: { taskId: string; items: FileDto[]; canEdit: boolean; selfMemberId: string }) {
  const { t, locale } = useI18n();
  const k = t.tasks;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function upload(file: File) {
    // Checked server-side too; this just saves a pointless upload
    if (file.size > MAX_BYTES) return setError(t.errors.FILE_TOO_LARGE);
    const form = new FormData();
    form.append("file", file);
    setError(undefined);
    startTransition(async () => {
      const res = await api<FileDto>(`/tasks/${taskId}/files`, "POST", form);
      if (!res.ok) setError(errorMessage(t, res.code, res.details));
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  function remove(f: FileDto) {
    if (!window.confirm(interpolate(k.confirmDeleteFile, { name: f.name }))) return;
    startTransition(async () => {
      const res = await api(`/files/${f.id}`, "DELETE");
      if (!res.ok) setError(errorMessage(t, res.code));
      router.refresh();
    });
  }

  return (
    <section className="card" aria-busy={pending}>
      <header className="flex items-center justify-between px-5 pt-4">
        <h2 className="text-sm font-semibold">{k.files}</h2>
        <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent hover:underline">
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          {pending ? k.uploading : k.upload}
          <input ref={input} type="file" className="sr-only" disabled={pending} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </header>
      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-fg-muted">{k.noFiles}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {items.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-5 py-2">
              <a href={`/api/v1/files/${f.id}`} download={f.name} className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:text-accent">
                <Download className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
                <span className="truncate">{f.name}</span>
              </a>
              <span className="tabular shrink-0 text-xs text-fg-subtle">{formatBytes(f.sizeBytes, locale)}</span>
              {(canEdit || f.uploader?.id === selfMemberId) && (
                <button type="button" onClick={() => remove(f)} aria-label={`${k.deleteFile}: ${f.name}`} title={k.deleteFile} className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="px-5 pb-3 text-[11px] text-fg-subtle">{k.filesHint}</p>
      {error && <p role="alert" className="px-5 pb-3 text-xs text-danger">{error}</p>}
    </section>
  );
}
