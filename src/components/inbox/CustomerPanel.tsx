"use client";

import type { ConversationDetailDto, DepartmentDto, MemberDto } from "@/shared";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/api/client";
import { formatDuration } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

export function CustomerPanel({ conversation: c, members, departments }: { conversation: ConversationDetailDto; members: MemberDto[]; departments: DepartmentDto[] }) {
  const { t, locale } = useI18n();
  const k = t.inbox;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const run = (fn: () => Promise<{ ok: boolean; code?: string }>) =>
    startTransition(async () => {
      setError(undefined);
      const res = await fn();
      if (!res.ok) setError(errorMessage(t, res.code));
      router.refresh();
    });

  return (
    <div className="space-y-5 p-4" aria-busy={pending}>
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{k.customer}</h2>
        <p className="mt-2 text-sm font-medium">{c.displayName || k.visitor}</p>
        {c.handle && <p className="text-xs text-fg-muted">{c.handle}</p>}
        {c.contact ? (
          <Link href={`/crm/${c.contact.id}`} className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
            {k.openCard} →
          </Link>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => api(`/inbox/conversations/${c.id}/contact`, "POST", {}))}
            className="btn-ghost mt-2 h-8 border border-border text-xs"
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {k.addToCrm}
          </button>
        )}
      </section>

      <section className="space-y-3">
        <label className="field-label">
          {k.assignee}
          <select
            value={c.assignee?.id ?? ""}
            disabled={!c.can.assign || pending}
            onChange={(e) => run(() => api(`/inbox/conversations/${c.id}`, "PATCH", { assigneeId: e.target.value || null }))}
            className="input"
          >
            <option value="">{k.unassigned}</option>
            {members
              .filter((m) => m.status === "ACTIVE" || m.id === c.assignee?.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
          </select>
        </label>
        {departments.length > 0 && (
          <label className="field-label">
            {k.department}
            <select
              value={c.departmentId ?? ""}
              disabled={!c.can.assign || pending}
              onChange={(e) => run(() => api(`/inbox/conversations/${c.id}`, "PATCH", { departmentId: e.target.value || null }))}
              className="input"
            >
              <option value="">{k.noDepartment}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {c.firstResponseMs !== null && (
        <p className="text-xs text-fg-muted">{interpolate(k.firstResponse, { time: formatDuration(c.firstResponseMs / 60000, locale) })}</p>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
