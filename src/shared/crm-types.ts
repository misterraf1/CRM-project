import type { LifecycleStage } from "./crm-schemas";
import type { CustomFieldValues } from "./crm-settings";

export interface MemberRefDto {
  id: string;
  name: string;
}

export interface ContactDto {
  id: string;
  type: "person" | "company";
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  /** Linked company contact (people only) */
  companyId: string | null;
  stage: LifecycleStage;
  source: string | null;
  tags: string[];
  customFields: CustomFieldValues;
  owner: MemberRefDto | null;
  openDeals: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactListResponse {
  items: ContactDto[];
  nextCursor: string | null;
  total: number;
}

export type StageKind = "open" | "won" | "lost";

export interface StageDto {
  id: string;
  name: string;
  order: number;
  probability: number;
  kind: StageKind;
}

export interface PipelineDto {
  id: string;
  name: string;
  isDefault: boolean;
  stages: StageDto[];
}

export interface DealDto {
  id: string;
  title: string;
  amount: number;
  currency: string;
  /** The amount in the company currency (at the deal's last saved rate; closed deals keep theirs) */
  baseAmount: number;
  pipelineId: string;
  stageId: string;
  position: number;
  contact: { id: string; name: string } | null;
  owner: MemberRefDto | null;
  expectedClose: string | null;
  closedAt: string | null;
  lostReason: string | null;
  customFields: CustomFieldValues;
  createdAt: string;
}

export interface ContactDetailDto extends ContactDto {
  deals: DealDto[];
  /** Companies: the people linked to it (visible ones, at most 100) */
  people: { id: string; name: string; email: string | null; phone: string | null }[];
}

/** Payload carries display names captured at write time, so history stays readable after renames. */
export type ActivityType =
  | "note"
  | "contact_created"
  | "contact_stage"
  | "owner_changed"
  | "deal_created"
  | "deal_stage"
  | "deal_won"
  | "deal_lost";

export interface ActivityDto {
  id: string;
  type: ActivityType;
  contactId: string | null;
  dealId: string | null;
  actor: MemberRefDto | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ForecastDto {
  currency: string;
  open: { count: number; amount: number };
  /** Σ amount × stage probability over open deals */
  weighted: number;
  wonThisMonth: { count: number; amount: number };
  lostThisMonth: { count: number; amount: number; reasons: { reason: string; count: number }[] };
}

export interface Comparable {
  value: number;
  /** null when there is no meaningful baseline */
  previous: number | null;
}

/** Dashboard figures: CRM, tasks and inbox. */
export interface DashboardCrmDto {
  period: "7d" | "30d" | "90d";
  generatedAt: string;
  scope: "all" | "department" | "own";
  currency: string;
  kpis: {
    newContacts: Comparable;
    activeDeals: { value: number; pipelineValue: number };
    revenue: Comparable;
  };
  revenue: { bucket: "day" | "week"; points: { date: string; amount: number; deals: number }[] };
  team: {
    member: MemberRefDto & { title: string | null };
    dealsWon: number;
    revenue: number;
    tasksDone: number;
    tasksOverdue: number;
    /** Average first response in the inbox, minutes; null without conversations */
    avgResponseMin: number | null;
  }[];
  inbox: {
    awaiting: number;
    longestWaitMin: number | null;
    avgFirstResponseMin: number | null;
    /** Longest-waiting first, at most 5 */
    items: { id: string; channel: "WHATSAPP" | "INSTAGRAM" | "MESSENGER" | "WEBCHAT" | "EMAIL"; displayName: string; preview: string; waitingSince: string; assignee: MemberRefDto | null }[];
  };
  tasks: {
    open: number;
    overdue: number;
    /** Most overdue first, at most 5 */
    overdueItems: { id: string; title: string; dueAt: string; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; assignee: MemberRefDto | null }[];
  };
  activity: ActivityDto[];
}
