import type { ActivityDto, ActivityType, LifecycleStage } from "@/shared";
import { CheckCircle2, FileCheck2, PackageCheck, PackagePlus, FileText, FileX2, Handshake, MoveRight, Receipt, StickyNote, UserCog, UserPlus, Wallet, XCircle, type LucideIcon } from "lucide-react";
import { formatMoney, formatMoneyExact } from "./format";
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
  quote_sent: { icon: FileText, className: "text-accent" },
  quote_accepted: { icon: FileCheck2, className: "text-success" },
  quote_rejected: { icon: FileX2, className: "text-danger" },
  invoice_issued: { icon: Receipt, className: "text-accent" },
  invoice_paid: { icon: Wallet, className: "text-success" },
  order_created: { icon: PackagePlus, className: "text-accent" },
  order_done: { icon: PackageCheck, className: "text-success" },
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
    // Documents carry their own currency and exact amounts
    amount: p.currency ? formatMoneyExact(Number(p.amount ?? 0), locale, String(p.currency)) : formatMoney(Number(p.amount ?? 0), locale),
    number: String(p.number ?? ""),
    by: String(p.by ?? ""),
    from: a.type === "contact_stage" ? stage(p.from) : String(p.from ?? ""),
    to: a.type === "contact_stage" ? stage(p.to) : String(p.to ?? ""),
    reason: reason(p.reason),
  };
  return interpolate(t.dashboard.activity[a.type], vars);
}
