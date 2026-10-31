"use client";

import { CHANNEL_TYPES, CONVERSATION_STATUSES } from "@/shared";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";

const ASSIGNEES = ["all", "me", "unassigned"] as const;

/** Channel, status and assignee as compact dropdowns; a choice reloads the list. */
export function InboxFilters({ values, hrefFor }: { values: { channelType?: string; status: string; assignee: string }; hrefFor: Record<"channelType" | "status" | "assignee", Record<string, string>> }) {
  const { t } = useI18n();
  const k = t.inbox;
  const router = useRouter();
  const select = "h-9 appearance-none rounded-lg border border-border bg-surface pl-3 pr-7 text-xs font-medium text-fg outline-none hover:bg-muted/60 focus:border-accent";
  const wrap = (label: string, value: string, key: "channelType" | "status" | "assignee", options: [string, string][]) => (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => router.push(hrefFor[key][e.target.value]!)} className={select}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-fg-subtle" aria-hidden />
    </label>
  );
  return (
    <div className="flex flex-wrap gap-1.5">
      {wrap(k.channelFilter, values.channelType ?? "", "channelType", [["", k.allChannels], ...CHANNEL_TYPES.map((c): [string, string] => [c, t.channels.types[c]])])}
      {wrap(k.statusFilter, values.status, "status", [...CONVERSATION_STATUSES.map((s): [string, string] => [s, k.statuses[s]]), ["ALL", k.statuses.ALL]])}
      {wrap(k.assigneeFilter, values.assignee, "assignee", ASSIGNEES.map((a): [string, string] => [a, a === "all" ? t.crm.ownerAll : k.assignees[a]]))}
    </div>
  );
}
