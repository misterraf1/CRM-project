"use client";

import type { MemberDto } from "@/shared";
import clsx from "clsx";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { api } from "@/lib/api/client";

let cache: Promise<MemberDto[]> | null = null;
/** Active colleagues, loaded once per page on the first "@". */
const loadMembers = () =>
  (cache ??= api<MemberDto[]>("/members").then((r) => (r.ok ? r.data.filter((m) => m.status === "ACTIVE") : [])));

/** The "@query" being typed right before the caret, if any. */
function mentionAt(text: string, caret: number) {
  const m = /(^|\s)@([\p{L}\p{N}.'-]*(?: [\p{L}\p{N}.'-]*)?)$/u.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]!.toLocaleLowerCase() } : null;
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & { value: string; onChange: (value: string) => void };

/**
 * A textarea where "@" suggests colleagues; picking one inserts "@Full Name", which the
 * server turns into a notification for that person (if they may see the record).
 */
export function MentionTextarea({ value, onChange, onKeyDown, className, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  const matches = mention ? members.filter((m) => m.fullName.toLocaleLowerCase().includes(mention.query)).slice(0, 6) : [];
  const open = !!mention && matches.length > 0;

  useEffect(() => {
    if (mention && !members.length) void loadMembers().then(setMembers);
  }, [mention, members.length]);

  function update(text: string, caret: number) {
    onChange(text);
    setMention(mentionAt(text, caret));
    setActive(0);
  }

  function pick(m: MemberDto) {
    if (!mention || !ref.current) return;
    const caret = ref.current.selectionStart;
    const next = `${value.slice(0, mention.start)}@${m.fullName} ${value.slice(caret)}`;
    onChange(next);
    setMention(null);
    const pos = mention.start + m.fullName.length + 2;
    requestAnimationFrame(() => ref.current?.setSelectionRange(pos, pos));
  }

  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[active]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    onKeyDown?.(e);
  }

  return (
    <div className="relative">
      <textarea
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => update(e.target.value, e.target.selectionStart)}
        onKeyDown={keys}
        onBlur={() => setTimeout(() => setMention(null), 150)}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        className={className}
      />
      {open && (
        <ul id={listId} role="listbox" className="card absolute left-0 top-full z-20 mt-1 max-h-56 w-64 overflow-y-auto py-1 shadow-lg">
          {matches.map((m, i) => (
            <li
              key={m.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              className={clsx("cursor-pointer px-3 py-1.5 text-sm", i === active ? "bg-accent-soft text-accent" : "hover:bg-muted")}
            >
              {m.fullName}
              {m.title && <span className="ml-1 text-xs text-fg-subtle">{m.title}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
