import type { HideableModule, Permission } from "@/shared";
import { CalendarPlus, CheckSquare, FilePlus2, Handshake, Headset, UserPlus, type LucideIcon } from "lucide-react";

export type QuickCreateKey = "contact" | "deal" | "task" | "meeting" | "quote" | "case";

/** The everyday "new …" actions: the dashboard tiles and the header's Create menu. */
export const QUICK_CREATE: { key: QuickCreateKey; href: string; icon: LucideIcon; tone: string; permission?: Permission; module?: HideableModule }[] = [
  { key: "contact", href: "/crm/new", icon: UserPlus, tone: "text-accent bg-accent-soft", permission: "contacts.create" },
  { key: "deal", href: "/deals?new=1", icon: Handshake, tone: "text-brand-violet bg-brand-violet/10", permission: "deals.create", module: "deals" },
  { key: "task", href: "/tasks", icon: CheckSquare, tone: "text-success bg-success/10", permission: "tasks.create" },
  { key: "meeting", href: "/calendar?new=1", icon: CalendarPlus, tone: "text-brand-teal bg-brand-teal/10", permission: "tasks.create", module: "calendar" },
  { key: "quote", href: "/sales/new", icon: FilePlus2, tone: "text-warning bg-warning/10", permission: "quotes.manage", module: "sales" },
  { key: "case", href: "/cases/new", icon: Headset, tone: "text-danger bg-danger/10", permission: "cases.manage", module: "cases" },
];

/** Actions the member may take, leaving out sections the company has hidden. */
export const allowedQuickCreate = (permissions: Permission[], hidden: readonly string[] = []) =>
  QUICK_CREATE.filter((a) => (!a.permission || permissions.includes(a.permission)) && !(a.module && hidden.includes(a.module)));
