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
