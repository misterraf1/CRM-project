import {
  BarChart3,
  CheckSquare,
  FolderOpen,
  Handshake,
  LayoutDashboard,
  MessageSquareText,
  MessagesSquare,
  Settings,
  Users,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Dictionary } from "./i18n/dictionaries/az";

export type ModuleKey = Exclude<keyof Dictionary["nav"], "groupWork" | "groupManage">;

export interface NavItem {
  key: ModuleKey;
  href: string;
  icon: LucideIcon;
  /** Development phase that delivers the module (docs/ARCHITECTURE.md §11); null = available now. */
  phase: number | null;
  /** Sidebar counter fed by the shell summary. */
  badge?: "awaiting" | "overdue";
}

export const NAV_GROUPS: { label: "groupWork" | "groupManage"; items: NavItem[] }[] = [
  {
    label: "groupWork",
    items: [
      { key: "dashboard", href: "/dashboard", icon: LayoutDashboard, phase: null },
      { key: "inbox", href: "/inbox", icon: MessageSquareText, phase: 4, badge: "awaiting" },
      { key: "crm", href: "/crm", icon: Users, phase: null },
      { key: "deals", href: "/deals", icon: Handshake, phase: null },
      { key: "tasks", href: "/tasks", icon: CheckSquare, phase: null, badge: "overdue" },
      { key: "chat", href: "/chat", icon: MessagesSquare, phase: 5 },
    ],
  },
  {
    label: "groupManage",
    items: [
      { key: "team", href: "/team", icon: UsersRound, phase: null },
      { key: "files", href: "/files", icon: FolderOpen, phase: 8 },
      { key: "analytics", href: "/analytics", icon: BarChart3, phase: 8 },
      { key: "automations", href: "/automations", icon: Workflow, phase: 8 },
      { key: "settings", href: "/settings", icon: Settings, phase: null },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export const PLANNED_MODULES = NAV_ITEMS.filter(
  (item): item is NavItem & { phase: number; key: Exclude<ModuleKey, "dashboard"> } =>
    item.phase !== null && item.key !== "dashboard",
);
