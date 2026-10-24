import {
  BarChart3,
  CheckSquare,
  FolderOpen,
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
import type { Permission } from "@axis/shared";
import type { Dictionary } from "./i18n/dictionaries/az";

export type ModuleKey = Exclude<keyof Dictionary["nav"], "groupWork" | "groupManage">;

export interface NavItem {
  key: ModuleKey;
  href: string;
  icon: LucideIcon;
  /** Development phase that delivers the module (docs/ARCHITECTURE.md §11); null = available now. */
  phase: number | null;
  /** Plan feature the module needs; without it the sidebar shows a lock. */
  feature?: string;
  /** Hidden from members without this permission (the API refuses them anyway). */
  permission?: Permission;
  /** Sidebar counter fed by the shell summary. */
  badge?: "awaiting" | "overdue" | "unreadChat";
}

export const NAV_GROUPS: { label: "groupWork" | "groupManage"; items: NavItem[] }[] = [
  {
    label: "groupWork",
    items: [
      { key: "dashboard", href: "/dashboard", icon: LayoutDashboard, phase: null },
      { key: "inbox", href: "/inbox", icon: MessageSquareText, phase: 4, badge: "awaiting" },
      { key: "crm", href: "/crm", icon: Users, phase: null },
      { key: "deals", href: "/deals", icon: Handshake, phase: null, feature: "deals.pipeline" },
      { key: "tasks", href: "/tasks", icon: CheckSquare, phase: null, badge: "overdue" },
      { key: "chat", href: "/chat", icon: MessagesSquare, phase: null, badge: "unreadChat" },
    ],
  },
  {
    label: "groupManage",
    items: [
      { key: "team", href: "/team", icon: UsersRound, phase: null, feature: "team.monitoring" },
      { key: "files", href: "/files", icon: FolderOpen, phase: 9 },
      { key: "analytics", href: "/analytics", icon: BarChart3, phase: null, feature: "analytics.basic", permission: "analytics.view" },
      { key: "automations", href: "/automations", icon: Workflow, phase: null, feature: "automations", permission: "automations.manage" },
      { key: "settings", href: "/settings", icon: Settings, phase: null },
      { key: "support", href: "/support", icon: LifeBuoy, phase: null },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export const PLANNED_MODULES = NAV_ITEMS.filter(
  (item): item is NavItem & { phase: number; key: Exclude<ModuleKey, "dashboard" | "support" | "analytics" | "automations"> } =>
    item.phase !== null && item.key !== "dashboard",
);
