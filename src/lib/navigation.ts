import {
  BarChart3,
  CalendarDays,
  Headset,
  Megaphone,
  Target,
  Sun,
  CheckSquare,
  FileText,
  FolderOpen,
  PackageCheck,
  Handshake,
  LayoutDashboard,
  LifeBuoy,
  MessageSquareText,
  MessagesSquare,
  Settings,
  Users,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/shared";
import type { Dictionary } from "./i18n/dictionaries/az";

type GroupKey = "groupWork" | "groupSales" | "groupService" | "groupManage";
export type ModuleKey = Exclude<keyof Dictionary["nav"], GroupKey>;

export interface NavItem {
  key: ModuleKey;
  href: string;
  icon: LucideIcon;
  /** Plan feature the module needs; without it the sidebar shows a lock. */
  feature?: string;
  /** Hidden from members without this permission (the API refuses them anyway). */
  permission?: Permission;
  /** Sidebar counter fed by the shell summary. */
  badge?: "awaiting" | "overdue" | "unreadChat";
}

/** Grouped like the working day: own work, selling, after-sale and outreach, running the company. */
export const NAV_GROUPS: { label: GroupKey; items: NavItem[] }[] = [
  {
    label: "groupWork",
    items: [
      { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
      { key: "today", href: "/today", icon: Sun },
      { key: "inbox", href: "/inbox", icon: MessageSquareText, badge: "awaiting" },
      { key: "tasks", href: "/tasks", icon: CheckSquare, badge: "overdue" },
      { key: "calendar", href: "/calendar", icon: CalendarDays },
      { key: "chat", href: "/chat", icon: MessagesSquare, badge: "unreadChat" },
    ],
  },
  {
    label: "groupSales",
    items: [
      { key: "crm", href: "/crm", icon: Users },
      { key: "deals", href: "/deals", icon: Handshake, feature: "deals.pipeline" },
      { key: "sales", href: "/sales", icon: FileText, permission: "quotes.manage" },
      { key: "orders", href: "/orders", icon: PackageCheck, permission: "orders.manage" },
    ],
  },
  {
    label: "groupService",
    items: [
      { key: "cases", href: "/cases", icon: Headset, permission: "cases.manage" },
      { key: "campaigns", href: "/campaigns", icon: Megaphone, permission: "campaigns.manage" },
    ],
  },
  {
    label: "groupManage",
    items: [
      { key: "team", href: "/team", icon: UsersRound, feature: "team.monitoring" },
      { key: "targets", href: "/targets", icon: Target },
      { key: "analytics", href: "/analytics", icon: BarChart3, feature: "analytics.basic", permission: "analytics.view" },
      { key: "automations", href: "/automations", icon: Workflow, feature: "automations", permission: "automations.manage" },
      { key: "files", href: "/files", icon: FolderOpen },
      { key: "settings", href: "/settings", icon: Settings },
      { key: "support", href: "/support", icon: LifeBuoy },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
