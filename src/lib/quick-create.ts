import type { Permission } from "@/shared";
import { CalendarPlus, CheckSquare, FilePlus2, Handshake, Headset, UserPlus, type LucideIcon } from "lucide-react";

export type QuickCreateKey = "contact" | "deal" | "task" | "meeting" | "quote" | "case";

/** The everyday "new …" actions: the dashboard tiles and the header's Create menu. */
export const QUICK_CREATE: { key: QuickCreateKey; href: string; icon: LucideIcon; tone: string; permission?: Permission }[] = [
  { key: "contact", href: "/crm/new", icon: UserPlus, tone: "text-accent bg-accent-soft", permission: "contacts.create" },
  { key: "deal", href: "/deals?new=1", icon: Handshake, tone: "text-brand-violet bg-brand-violet/10", permission: "deals.create" },
  { key: "task", href: "/tasks", icon: CheckSquare, tone: "text-success bg-success/10", permission: "tasks.create" },
  { key: "meeting", href: "/calendar?new=1", icon: CalendarPlus, tone: "text-brand-teal bg-brand-teal/10", permission: "tasks.create" },
  { key: "quote", href: "/sales/new", icon: FilePlus2, tone: "text-warning bg-warning/10", permission: "quotes.manage" },
  { key: "case", href: "/cases/new", icon: Headset, tone: "text-danger bg-danger/10", permission: "cases.manage" },
];

export const allowedQuickCreate = (permissions: Permission[]) => QUICK_CREATE.filter((a) => !a.permission || permissions.includes(a.permission));
