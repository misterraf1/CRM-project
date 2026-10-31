"use client";

import type { ContactListResponse } from "@/shared";
import { X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { api } from "@/lib/api/client";

type Option = { id: string; name: string };

/** Type-ahead customer picker (searches the whole base, not a preloaded page). */
export function ContactCombobox({ label, value, onChange, placeholder }: { label: string; value: Option | null; onChange: (v: Option | null) => void; placeholder: string }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    const ctrl = { cancelled: false };
    const timer = setTimeout(async () => {
      const res = await api<ContactListResponse>(`/contacts?limit=8${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
      if (!ctrl.cancelled && res.ok) {
        setOptions(res.data.items.map((c) => ({ id: c.id, name: c.name })));
        setActive(0);
      }
    }, 200);
    return () => {
      ctrl.cancelled = true;
      clearTimeout(timer);
    };
  }, [q, open]);

  if (value) {
    return (
      <div className="field-label">
        {label}
        <div className="input flex items-center justify-between gap-2">
          <span className="truncate">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label={`${label}: ${value.name} ×`} className="rounded p-0.5 text-fg-subtle hover:text-fg">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const pick = (o: Option) => {
    onChange(o);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="relative">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, options.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === "Enter" && open && options[active]) (e.preventDefault(), pick(options[active]!));
          else if (e.key === "Escape") setOpen(false);
        }}
        className="input mt-1"
      />
      {open && options.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="card absolute z-20 mt-1 max-h-56 w-full overflow-y-auto py-1 shadow-lg">
          {options.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(o))}
              className={`cursor-pointer truncate px-3 py-1.5 text-sm ${i === active ? "bg-accent-soft text-accent" : "hover:bg-muted"}`}
            >
              {o.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
