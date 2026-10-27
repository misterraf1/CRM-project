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
      { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
      { key: "inbox", href: "/inbox", icon: MessageSquareText, badge: "awaiting" },
      { key: "crm", href: "/crm", icon: Users },
      { key: "deals", href: "/deals", icon: Handshake, feature: "deals.pipeline" },
      { key: "tasks", href: "/tasks", icon: CheckSquare, badge: "overdue" },
      { key: "chat", href: "/chat", icon: MessagesSquare, badge: "unreadChat" },
    ],
  },
  {
    label: "groupManage",
    items: [
      { key: "team", href: "/team", icon: UsersRound, feature: "team.monitoring" },
      { key: "files", href: "/files", icon: FolderOpen },
      { key: "analytics", href: "/analytics", icon: BarChart3, feature: "analytics.basic", permission: "analytics.view" },
      { key: "automations", href: "/automations", icon: Workflow, feature: "automations", permission: "automations.manage" },
      { key: "settings", href: "/settings", icon: Settings },
      { key: "support", href: "/support", icon: LifeBuoy },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
