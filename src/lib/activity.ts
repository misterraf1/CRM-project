import type { ActivityDto, ActivityType, LifecycleStage } from "@/shared";
import { CheckCircle2, Handshake, MoveRight, StickyNote, UserCog, UserPlus, XCircle, type LucideIcon } from "lucide-react";
import { formatMoney } from "./format";
import type { Dictionary } from "./i18n/dictionaries/az";
import { interpolate, type Locale } from "./i18n/locales";

export const ACTIVITY_ICONS: Record<ActivityType, { icon: LucideIcon; className: string }> = {
  note: { icon: StickyNote, className: "text-warning" },
  contact_created: { icon: UserPlus, className: "text-accent" },
  contact_stage: { icon: MoveRight, className: "text-accent" },
  owner_changed: { icon: UserCog, className: "text-fg-muted" },
  deal_created: { icon: Handshake, className: "text-accent" },
  deal_stage: { icon: MoveRight, className: "text-accent" },
  deal_won: { icon: CheckCircle2, className: "text-success" },
  deal_lost: { icon: XCircle, className: "text-danger" },
};

/** One-line, localized description. Names come from the payload captured at write time. */
export function describeActivity(a: ActivityDto, t: Dictionary, locale: Locale): string {
  const p = a.payload as Record<string, string | number | null | undefined>;
  const stage = (s: unknown) => t.crm.stages[s as LifecycleStage] ?? String(s ?? "");
  const reason = (r: unknown) => t.deals.reasons[r as keyof Dictionary["deals"]["reasons"]] ?? String(r ?? "");
  const vars = {
    actor: a.actor?.name ?? t.dashboard.activity.system,
    contact: String(p.contactName ?? ""),
    deal: String(p.dealTitle ?? ""),
    owner: String(p.ownerName ?? t.crm.unassigned),
    amount: formatMoney(Number(p.amount ?? 0), locale),
    from: a.type === "contact_stage" ? stage(p.from) : String(p.from ?? ""),
    to: a.type === "contact_stage" ? stage(p.to) : String(p.to ?? ""),
    reason: reason(p.reason),
  };
  return interpolate(t.dashboard.activity[a.type], vars);
}
