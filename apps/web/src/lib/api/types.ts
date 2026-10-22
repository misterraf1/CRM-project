// Dashboard contracts the API will implement in Phase 2 (GET /v1/dashboard).
// Identity/session types live in @axis/shared (MeResponse).
// Money values are minor units (qəpik). Dates are ISO-8601 strings.

export const PERIODS = ["7d", "30d", "90d"] as const;
export type Period = (typeof PERIODS)[number];

export type ChannelType = "WHATSAPP" | "INSTAGRAM" | "MESSENGER" | "WEBCHAT" | "EMAIL";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface ShellSummary {
  awaiting: number;
  overdue: number;
  /** True while these counters come from the demo source (inbox/tasks not built yet). */
  demo: boolean;
}

export interface Comparable {
  value: number;
  previous: number;
}

export interface MemberRef {
  id: string;
  name: string;
}

export interface ConversationPreview {
  id: string;
  channel: ChannelType;
  contactName: string;
  preview: string;
  waitingSince: string;
  assignee: MemberRef | null;
}

export interface TaskPreview {
  id: string;
  title: string;
  dueAt: string;
  priority: Priority;
  assignee: MemberRef;
}

export interface MemberPerformance {
  member: MemberRef & { title: string };
  dealsWon: number;
  revenue: number;
  tasksDone: number;
  tasksOverdue: number;
  /** Average first response in inbox, minutes; null when the member handles no conversations. */
  avgResponseMin: number | null;
}

export type ActivityItem =
  | { id: string; at: string; kind: "deal_won"; actor: MemberRef; subject: string; amount: number }
  | { id: string; at: string; kind: "deal_stage"; actor: MemberRef; subject: string; stage: string }
  | { id: string; at: string; kind: "contact_created"; actor: MemberRef; subject: string }
  | { id: string; at: string; kind: "task_done"; actor: MemberRef; subject: string }
  | { id: string; at: string; kind: "message_in"; subject: string; channel: ChannelType }
  | { id: string; at: string; kind: "member_joined"; subject: string };

export interface RevenuePoint {
  /** Bucket start date */
  date: string;
  amount: number;
  deals: number;
}

export interface DashboardData {
  period: Period;
  generatedAt: string;
  /** Scope applied by the API from the caller's role: all | department | own */
  scope: "all" | "department" | "own";
  kpis: {
    newContacts: Comparable;
    activeDeals: Comparable & { pipelineValue: number };
    revenue: Comparable;
    awaiting: { value: number; longestWaitMin: number };
    openTasks: { value: number; overdue: number };
  };
  revenue: { bucket: "day" | "week"; points: RevenuePoint[] };
  inbox: { avgFirstResponseMin: number; items: ConversationPreview[] };
  overdueTasks: TaskPreview[];
  team: MemberPerformance[];
  activity: ActivityItem[];
}
