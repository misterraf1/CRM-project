"use client";

import type { SavedViewDto, ViewEntity } from "@/shared";
import clsx from "clsx";
import { Bookmark, BookmarkPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

const normal = (q: string) => [...new URLSearchParams(q)].filter(([k]) => k !== "page").sort().map(([k, v]) => `${k}=${v}`).join("&");

/** Saved filter sets as chips above a list; the current filters can be saved under a name. */
export function SavedViews({ entity, base, initial, current, canShare }: { entity: ViewEntity; base: string; initial: SavedViewDto[]; current: string; canShare: boolean }) {
  const { t } = useI18n();
  const k = t.views;
  const [views, setViews] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const active = normal(current);

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      setError(undefined);
      const res = await api<SavedViewDto[]>("/views", "POST", { entity, name: String(data.get("name") ?? ""), query: current, shared: data.get("shared") === "on" });
      if (!res.ok) return setError(errorMessage(t, res.code));
      setViews(res.data);
      setAdding(false);
    });
  };

  const remove = (v: SavedViewDto) =>
    startTransition(async () => {
      const res = await api<SavedViewDto[]>(`/views/${v.id}`, "DELETE");
      if (!res.ok) return setError(errorMessage(t, res.code));
      setViews(res.data);
    });

  if (!views.length && !active && !adding) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted">
        <Bookmark className="h-3.5 w-3.5" aria-hidden />
        {k.title}
      </span>
      {views.map((v) => {
        const on = normal(v.query) === active;
        return (
          <span key={v.id} className={clsx("inline-flex items-center rounded-full border text-sm", on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface")}>
            <Link href={`${base}${v.query ? `?${v.query}` : ""}`} aria-current={on ? "true" : undefined} className="inline-flex items-center gap-1.5 py-1 pl-3 pr-2 font-medium">
              {v.shared && <Users className="h-3.5 w-3.5" aria-label={k.shared} />}
              {v.name}
            </Link>
            {(v.mine || canShare) && (
              <button type="button" onClick={() => remove(v)} aria-label={`${k.remove}: ${v.name}`} className="mr-1 grid h-6 w-6 place-items-center rounded-full text-fg-subtle hover:bg-muted hover:text-fg">
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </span>
        );
      })}
      {adding ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <input name="name" required maxLength={60} placeholder={k.name} aria-label={k.name} autoFocus className="input mt-0 h-8 w-44 text-sm" />
          {canShare && (
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" name="shared" className="h-4 w-4" />
              {k.share}
            </label>
          )}
          <button type="submit" disabled={pending} className="btn-primary h-8 text-xs">
            {k.save}
          </button>
          <button type="button" onClick={() => setAdding(false)} className="btn-ghost h-8 text-xs">
            {k.cancel}
          </button>
        </form>
      ) : (
        active &&
        !views.some((v) => normal(v.query) === active) && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-sm font-medium text-accent hover:bg-accent-soft/40">
            <BookmarkPlus className="h-3.5 w-3.5" aria-hidden />
            {k.add}
          </button>
        )
      )}
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </div>
  );
}
