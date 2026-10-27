import { z } from "zod";
import type { ChannelType } from "./inbox-schemas";

export const ANALYTICS_PERIODS = ["30d", "90d", "365d"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
export const analyticsQuerySchema = z.object({ period: z.enum(ANALYTICS_PERIODS).default("90d") });

/** Visibility of the figures: everything, the caller's department, or their own records. */
export type AnalyticsScope = "all" | "department" | "own";

export interface FunnelStage {
  stageId: string;
  name: string;
  kind: "open" | "won" | "lost";
  /** Deals sitting in this stage now */
  deals: number;
  amount: number;
}

/** "Əsas analitika" (PRO) */
export interface AnalyticsBasicDto {
  period: AnalyticsPeriod;
  scope: AnalyticsScope;
  currency: string;
  generatedAt: string;
  sales: {
    /** Deals created in the period and what became of them */
    created: number;
    won: number;
    lost: number;
    stillOpen: number;
    /** won / (won + lost) over deals closed in the period, 0..1; null without closed deals */
    winRate: number | null;
    wonAmount: number;
    avgDealSize: number | null;
    /** Days from creation to win, deals won in the period */
    avgCycleDays: number | null;
  };
  funnel: FunnelStage[];
  lostReasons: { reason: string; deals: number; amount: number }[];
  sources: { source: string; contacts: number; customers: number; wonDeals: number; wonAmount: number }[];
  inbox: { channel: ChannelType; conversations: number; avgFirstResponseMin: number | null }[];
  tasks: { created: number; completed: number; completedOnTime: number; overdueOpen: number };
}

export interface MemberPerformance {
  member: { id: string; name: string; title: string | null };
  dealsCreated: number;
  dealsWon: number;
  dealsLost: number;
  winRate: number | null;
  revenue: number;
  avgCycleDays: number | null;
  tasksDone: number;
  /** Share of completed tasks with a due date that were done on time, 0..1 */
  onTimeRate: number | null;
  conversations: number;
  avgFirstResponseMin: number | null;
}

export interface MonthTrend {
  /** Local month start */
  month: string;
  newContacts: number;
  dealsWon: number;
  revenue: number;
}

/** "Geniş analitika" (BUSINESS) */
export interface AnalyticsAdvancedDto {
  period: AnalyticsPeriod;
  scope: AnalyticsScope;
  currency: string;
  members: MemberPerformance[];
  /** Last 12 months, regardless of the period filter */
  months: MonthTrend[];
}
