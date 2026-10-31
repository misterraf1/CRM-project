import type { ActivityDto, MemberRefDto } from "./crm-types";
import type { TaskPriority, TaskStatus } from "./task-schemas";

export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: MemberRefDto | null;
  creator: MemberRefDto | null;
  dueAt: string | null;
  completedAt: string | null;
  overdue: boolean;
  recurrence: string | null;
  reminderMinutes: number | null;
  project: { id: string; name: string } | null;
  parentId: string | null;
  contact: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  subtasks: { done: number; total: number };
  comments: number;
  files: number;
  position: number;
  createdAt: string;
  /** What the caller may do — mirrors the API's checks so the UI can hide controls */
  can: { edit: boolean; delete: boolean };
}

export interface CommentDto {
  id: string;
  author: MemberRefDto | null;
  body: string;
  createdAt: string;
}

export interface FileDto {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploader: MemberRefDto | null;
  createdAt: string;
}

export const FILE_SOURCES = ["library", "task", "chat"] as const;
export type FileSource = (typeof FILE_SOURCES)[number];

/** A file in the Files section, with where it lives */
export interface FileListItemDto extends FileDto {
  source: { type: FileSource; id: string | null; title: string | null };
  canDelete: boolean;
}

export interface FileListResponse {
  items: FileListItemDto[];
  total: number;
  storage: { usedMb: number; limitMb: number };
}

export interface TaskDetailDto extends TaskDto {
  subtaskItems: TaskDto[];
  commentItems: CommentDto[];
  fileItems: FileDto[];
}

export interface ProjectDto {
  id: string;
  name: string;
  archived: boolean;
  openTasks: number;
}

export type NotificationType =
  | "task_assigned"
  | "task_comment"
  | "task_completed"
  | "task_overdue"
  | "billing_paid"
  | "billing_payment_failed"
  | "billing_trial_ending"
  | "billing_suspended"
  /** Manual billing: the paid period is over and the renewal is due */
  | "billing_period_ended"
  | "quote_accepted"
  | "quote_rejected"
  | "invoice_overdue"
  | "discount_approval_requested"
  | "discount_approved"
  | "discount_rejected"
  | "order_step_assigned"
  | "order_done"
  /** "@Name" in a contact note or task comment */
  | "mention"
  /** Calendar: added to an event, and the reminder before it starts */
  | "event_invited"
  | "event_reminder"
  /** Reminder before a task's deadline */
  | "task_reminder"
  /** Customer complaints / service requests */
  | "case_assigned"
  | "case_overdue"
  /** A recurring service is due for renewal */
  | "renewal_due"
  /** A website form brought a lead */
  | "form_submission"
  /** The customer added a document in their portal */
  | "portal_upload"
  | "support_reply"
  | "automation";

export interface NotificationDto {
  id: string;
  type: NotificationType;
  payload: { taskId?: string; title?: string; actorName?: string; invoiceId?: string; ticketId?: string; dealId?: string; contactId?: string; conversationId?: string; [k: string]: unknown };
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationDto[];
  unread: number;
}

export interface ShellSummaryDto {
  /** My overdue tasks */
  overdueTasks: number;
  /** Conversations waiting for a reply, within the caller's inbox scope */
  awaitingConversations: number;
  /** Unread team-chat messages across my rooms */
  unreadChat: number;
  unreadNotifications: number;
}

export interface MemberStatsDto {
  member: MemberRefDto & { title: string | null; role: string; departmentId: string | null; email: string };
  openTasks: number;
  overdueTasks: number;
  tasksDone: number;
  dealsWon: number;
  revenue: number;
  openDeals: number;
}

export interface MemberProfileDto extends MemberStatsDto {
  joinedAt: string | null;
  department: string | null;
  tasks: TaskDto[];
  activity: ActivityDto[];
}

/** Notifications a member may turn off for themselves (billing notices always arrive). */
export const MUTABLE_NOTIFICATIONS = [
  "mention",
  "task_assigned",
  "task_comment",
  "task_completed",
  "task_overdue",
  "task_reminder",
  "event_invited",
  "event_reminder",
  "case_assigned",
  "case_overdue",
  "renewal_due",
  "form_submission",
  "portal_upload",
  "order_step_assigned",
  "order_done",
  "quote_accepted",
  "quote_rejected",
  "discount_approval_requested",
  "discount_approved",
  "discount_rejected",
  "invoice_overdue",
  "automation",
  "support_reply",
] as const satisfies readonly NotificationType[];
