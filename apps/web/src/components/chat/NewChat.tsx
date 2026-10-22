"use client";

import type { MemberDto } from "@axis/shared";
import { Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";

export function NewChat({ members, selfMemberId }: { members: MemberDto[]; selfMemberId: string }) {
  const { t } = useI18n();
  const k = t.chat;
  const router = useRouter();
  const [mode, setMode] = useState<"direct" | "group" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const colleagues = members.filter((m) => m.status === "ACTIVE" && m.id !== selfMemberId);

  function open(path: string, body: unknown) {
    setError(undefined);
    startTransition(async () => {
      const res = await api<{ id: string }>(path, "POST", body);
      if (!res.ok) return setError(errorMessage(t, res.code));
      setMode(null);
      router.push(`/chat?r=${res.data.id}`);
      router.refresh();
    });
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (mode === "direct") open("/chat/rooms/direct", { memberId: String(f.get("memberId")) });
    else open("/chat/rooms", { name: String(f.get("name")), memberIds: f.getAll("memberIds").map(String) });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <button type="button" onClick={() => setMode(mode === "direct" ? null : "direct")} className="btn-ghost h-8 flex-1 border border-border text-xs">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {k.newDirect}
        </button>
        <button type="button" onClick={() => setMode(mode === "group" ? null : "group")} className="btn-ghost h-8 flex-1 border border-border text-xs">
          <Users className="h-3.5 w-3.5" aria-hidden />
          {k.newGroup}
        </button>
      </div>
      {mode && (
        <form onSubmit={submit} className="space-y-2 rounded-lg bg-muted/50 p-2.5" aria-busy={pending}>
          {mode === "direct" ? (
            <select name="memberId" required aria-label={k.pickColleague} defaultValue="" className="input mt-0">
              <option value="" disabled>
                {k.pickColleague}
              </option>
              {colleagues.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input name="name" required maxLength={80} placeholder={k.groupName} aria-label={k.groupName} className="input mt-0" />
              <fieldset className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-surface p-2">
                <legend className="sr-only">{k.groupMembers}</legend>
                {colleagues.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="memberIds" value={m.id} />
                    {m.fullName}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary h-8 text-xs">
              {mode === "direct" ? k.open : k.create}
            </button>
            <button type="button" onClick={() => setMode(null)} className="btn-ghost h-8 text-xs">
              {k.cancel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
