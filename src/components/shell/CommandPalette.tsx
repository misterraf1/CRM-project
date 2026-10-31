"use client";

import type { SearchHitDto } from "@/shared";
import clsx from "clsx";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";

/** Cmd+K / Ctrl+K: one search box for contacts, deals, tasks, conversations and documents. */
export function CommandPalette() {
  const { t } = useI18n();
  const k = t.shell.search;
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
    else {
      setQ("");
      setHits([]);
    }
  }, [open]);

  // Debounced: one request after typing pauses
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const res = await api<SearchHitDto[]>(`/search?q=${encodeURIComponent(term)}`);
      setHits(res.ok ? res.data : []);
      setActive(0);
      setLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  function go(hit: SearchHitDto | undefined) {
    if (!hit) return;
    setOpen(false);
    router.push(hit.href);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 text-xs text-fg-muted transition-colors hover:border-accent/40 hover:bg-surface lg:w-72" aria-keyshortcuts="Control+K Meta+K">
        <Search className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">{k.button}</span>
        <span className="hidden flex-1 truncate text-left text-fg-subtle lg:inline" aria-hidden>
          — {k.placeholder}
        </span>
        <kbd className="hidden rounded border border-border bg-surface px-1 font-sans text-[10px] sm:inline">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={k.title} className="card w-full max-w-xl overflow-hidden shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 text-fg-subtle" aria-hidden />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  else if (e.key === "ArrowDown" && hits.length) {
                    e.preventDefault();
                    setActive((i) => (i + 1) % hits.length);
                  } else if (e.key === "ArrowUp" && hits.length) {
                    e.preventDefault();
                    setActive((i) => (i + hits.length - 1) % hits.length);
                  } else if (e.key === "Enter") go(hits[active]);
                }}
                role="combobox"
                aria-expanded={hits.length > 0}
                aria-controls={listId}
                aria-activedescendant={hits.length ? `${listId}-${active}` : undefined}
                aria-label={k.title}
                placeholder={k.placeholder}
                className="h-12 flex-1 bg-transparent text-sm outline-none"
              />
              <kbd className="rounded border border-border px-1.5 text-[10px] text-fg-subtle">Esc</kbd>
            </div>
            <ul id={listId} role="listbox" aria-label={k.title} className="max-h-[50vh] overflow-y-auto py-1">
              {q.trim().length >= 2 && !loading && hits.length === 0 && <li className="px-4 py-6 text-center text-sm text-fg-muted">{k.empty}</li>}
              {q.trim().length < 2 && <li className="px-4 py-6 text-center text-xs text-fg-subtle">{k.hint}</li>}
              {hits.map((h, i) => (
                <li
                  key={`${h.kind}-${h.id}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(h)}
                  className={clsx("flex cursor-pointer items-center gap-3 px-4 py-2", i === active && "bg-accent-soft")}
                >
                  <span className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{k.kinds[h.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{h.title}</span>
                    {h.subtitle && <span className="block truncate text-xs text-fg-muted">{h.subtitle}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
