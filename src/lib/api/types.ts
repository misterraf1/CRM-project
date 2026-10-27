// Web-side view models. Server data contracts live in @axis/shared.

export const PERIODS = ["7d", "30d", "90d"] as const;
export type Period = (typeof PERIODS)[number];

export interface ShellSummary {
  /** Conversations waiting for a reply (inbox scope) */
  awaiting: number;
  /** My overdue tasks */
  overdue: number;
  unreadNotifications: number;
  /** Unread team-chat messages */
  unreadChat: number;
}
