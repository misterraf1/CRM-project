// Document shapes of the MongoDB collections (one collection per model, named after it).
// Ids are strings stored in `_id`; the repository layer exposes them as `id` (see ./repo.ts).

/** Binary data (stored as BSON Binary, read back as a Buffer). */
export type Bytes = Buffer;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type PlatformRole = "NONE" | "SUPPORT" | "SUPER_ADMIN";
export type Locale = "AZ" | "EN" | "RU";
export type TenantStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";
export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";
export type BillingInterval = "MONTH" | "YEAR";
export type InvoiceStatus = "DRAFT" | "OPEN" | "PAID" | "FAILED" | "VOID";
export type MemberRole = "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE";
export type MemberStatus = "INVITED" | "ACTIVE" | "DISABLED";
export type LifecycleStage = "LEAD" | "QUALIFIED" | "CUSTOMER" | "CHURNED";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE" | "CANCELED";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type ChannelType = "WHATSAPP" | "INSTAGRAM" | "MESSENGER" | "WEBCHAT" | "EMAIL";
export type ConversationStatus = "OPEN" | "PENDING" | "RESOLVED";
export type MessageDirection = "INBOUND" | "OUTBOUND" | "INTERNAL_NOTE";

export interface User {
  id: string;
  email: string;
  passwordHash: string | null;
  fullName: string;
  avatarUrl: string | null;
  locale: Locale;
  platformRole: PlatformRole;
  emailVerified: Date | null;
  mfaSecret: string | null;
  mfaEnabledAt: Date | null;
  mfaLastStep: number | null;
  mfaRecoveryCodes: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminSession {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  tenantId: string;
  familyId: string;
  tokenHash: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  timezone: string;
  currency: string;
  locale: Locale;
  status: TenantStatus;
  lockVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  seatLimit: number;
  storageMb: number;
  aiCredits: number;
  extraSeatPrice: number;
  extraStorageGbPrice: number;
  features: string[];
  isPublic: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  interval: BillingInterval;
  extraSeats: number;
  extraStorageMb: number;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlanId: string | null;
  providerRef: string | null;
  paymentMethod: JsonValue | null;
  retryCount: number;
  nextRetryAt: Date | null;
  trialReminderSentAt: Date | null;
  demoNextChargeFails: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Invoice {
  id: string;
  tenantId: string;
  number: string;
  kind: string;
  status: InvoiceStatus;
  amount: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  lines: JsonValue;
  apply: JsonValue | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface Payment {
  id: string;
  tenantId: string;
  invoiceId: string;
  provider: string;
  providerRef: string;
  amount: number;
  status: string;
  failureCode: string | null;
  createdAt: Date;
}

export interface UsageCounter {
  id: string;
  tenantId: string;
  metric: string;
  period: Date;
  value: number;
}

export interface Counter {
  id: string;
  value: number;
}

export interface PlatformExpense {
  id: string;
  category: string;
  vendor: string;
  amount: number;
  currency: string;
  incurredOn: Date;
  note: string | null;
  createdAt: Date;
}

export interface Membership {
  id: string;
  tenantId: string;
  userId: string;
  role: MemberRole;
  status: MemberStatus;
  departmentId: string | null;
  title: string | null;
  permissions: string[];
  inviteToken: string | null;
  invitedAt: Date | null;
  joinedAt: Date | null;
  createdAt: Date;
}

export interface Department {
  id: string;
  tenantId: string;
  name: string;
  headId: string | null;
  parentId: string | null;
}

export interface Contact {
  id: string;
  tenantId: string;
  ownerId: string | null;
  type: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  stage: LifecycleStage;
  source: string | null;
  tags: string[];
  customFields: JsonValue;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Pipeline {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
}

export interface PipelineStage {
  id: string;
  tenantId: string;
  pipelineId: string;
  name: string;
  order: number;
  probability: number;
  kind: string;
}

export interface Deal {
  id: string;
  tenantId: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  ownerId: string | null;
  title: string;
  amount: number;
  currency: string;
  expectedClose: Date | null;
  closedAt: Date | null;
  lostReason: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Activity {
  id: string;
  tenantId: string;
  contactId: string | null;
  dealId: string | null;
  actorId: string | null;
  type: string;
  payload: JsonValue;
  createdAt: Date;
}

export interface Project {
  id: string;
  tenantId: string;
  name: string;
  ownerId: string | null;
  archived: boolean;
  createdAt: Date;
}

export interface Task {
  id: string;
  tenantId: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  creatorId: string;
  assigneeId: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  overdueNotifiedAt: Date | null;
  recurrence: string | null;
  contactId: string | null;
  dealId: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskComment {
  id: string;
  tenantId: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export interface Channel {
  id: string;
  tenantId: string;
  type: ChannelType;
  name: string;
  externalId: string;
  credentials: Bytes | null;
  demo: boolean;
  settings: JsonValue;
  status: string;
  createdAt: Date;
}

export interface Conversation {
  id: string;
  tenantId: string;
  channelId: string;
  contactId: string | null;
  externalThread: string;
  displayName: string | null;
  handle: string | null;
  lastInboundAt: Date | null;
  status: ConversationStatus;
  assigneeId: string | null;
  departmentId: string | null;
  unreadCount: number;
  lastMessageAt: Date | null;
  awaitingSince: Date | null;
  firstResponseMs: number | null;
  subject: string | null;
  emailReplyTo: string | null;
  createdAt: Date;
}

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  direction: MessageDirection;
  authorId: string | null;
  body: string | null;
  attachments: JsonValue;
  externalId: string | null;
  deliveryStatus: string | null;
  createdAt: Date;
}

export interface CannedResponse {
  id: string;
  tenantId: string;
  shortcut: string;
  body: string;
  isShared: boolean;
  ownerId: string | null;
}

export interface WebhookEvent {
  id: string;
  provider: string;
  externalId: string;
  payload: JsonValue;
  receivedAt: Date;
  processedAt: Date | null;
  error: string | null;
}

export interface ChatRoom {
  id: string;
  tenantId: string;
  kind: string;
  name: string | null;
  departmentId: string | null;
  directKey: string | null;
  createdById: string | null;
  createdAt: Date;
}

export interface ChatMember {
  id: string;
  tenantId: string;
  roomId: string;
  memberId: string;
  lastReadAt: Date | null;
}

export interface ChatMessage {
  id: string;
  tenantId: string;
  roomId: string;
  authorId: string;
  body: string | null;
  attachments: JsonValue;
  taskId: string | null;
  createdAt: Date;
  editedAt: Date | null;
}

export interface FileObject {
  id: string;
  tenantId: string;
  uploaderId: string;
  key: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
}

export interface Notification {
  id: string;
  tenantId: string;
  memberId: string;
  type: string;
  payload: JsonValue;
  readAt: Date | null;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  diff: JsonValue | null;
  ip: string | null;
  createdAt: Date;
}

export interface SupportTicket {
  id: string;
  tenantId: string;
  authorId: string;
  subject: string;
  body: string;
  status: string;
  priority: Priority;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportTicketMessage {
  id: string;
  tenantId: string;
  ticketId: string;
  authorId: string;
  fromStaff: boolean;
  body: string;
  createdAt: Date;
}

export interface AutomationRule {
  id: string;
  tenantId: string;
  name: string;
  trigger: string;
  conditions: JsonValue;
  actions: JsonValue;
  enabled: boolean;
  createdById: string;
  rrCursor: number;
  runCount: number;
  lastRunAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationEvent {
  id: string;
  tenantId: string;
  trigger: string;
  payload: JsonValue;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface AutomationRun {
  id: string;
  tenantId: string;
  ruleId: string;
  eventId: string;
  status: string;
  detail: string | null;
  createdAt: Date;
}

export interface PasswordReset {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  ip: string | null;
  createdAt: Date;
}

export interface EmailMessage {
  id: string;
  tenantId: string | null;
  to: string;
  subject: string;
  text: string;
  html: string;
  template: string;
  inboxMessageId: string | null;
  from: string | null;
  headers: JsonValue;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export interface Models {
  User: User;
  AdminSession: AdminSession;
  Session: Session;
  Tenant: Tenant;
  Plan: Plan;
  Subscription: Subscription;
  Invoice: Invoice;
  Payment: Payment;
  UsageCounter: UsageCounter;
  Counter: Counter;
  PlatformExpense: PlatformExpense;
  Membership: Membership;
  Department: Department;
  Contact: Contact;
  Pipeline: Pipeline;
  PipelineStage: PipelineStage;
  Deal: Deal;
  Activity: Activity;
  Project: Project;
  Task: Task;
  TaskComment: TaskComment;
  Channel: Channel;
  Conversation: Conversation;
  Message: Message;
  CannedResponse: CannedResponse;
  WebhookEvent: WebhookEvent;
  ChatRoom: ChatRoom;
  ChatMember: ChatMember;
  ChatMessage: ChatMessage;
  FileObject: FileObject;
  Notification: Notification;
  AuditLog: AuditLog;
  SupportTicket: SupportTicket;
  SupportTicketMessage: SupportTicketMessage;
  AutomationRule: AutomationRule;
  AutomationEvent: AutomationEvent;
  AutomationRun: AutomationRun;
  PasswordReset: PasswordReset;
  EmailMessage: EmailMessage;
}
export type ModelName = keyof Models;

/** Filled in on insert when a field is left out: schema defaults, `null` for optional fields, `[]` for lists ("now" = current time). */
export const DEFAULTS: { [M in ModelName]: Partial<Record<keyof Models[M], unknown>> } = {
  User: { passwordHash: null, avatarUrl: null, locale: "AZ", platformRole: "NONE", emailVerified: null, mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [], lastLoginAt: null, createdAt: "now", updatedAt: "now" },
  AdminSession: { revokedAt: null, ip: null, userAgent: null, createdAt: "now" },
  Session: { userAgent: null, ip: null, rotatedAt: null, revokedAt: null, createdAt: "now" },
  Tenant: { logoUrl: null, timezone: "Asia/Baku", currency: "AZN", locale: "AZ", status: "TRIALING", lockVersion: 0, createdAt: "now", updatedAt: "now" },
  Plan: { currency: "AZN", aiCredits: 0, extraSeatPrice: 900, extraStorageGbPrice: 500, features: [], isPublic: true, sortOrder: 0, createdAt: "now", updatedAt: "now" },
  Subscription: { status: "TRIALING", interval: "MONTH", extraSeats: 0, extraStorageMb: 0, trialEndsAt: null, graceEndsAt: null, cancelAtPeriodEnd: false, scheduledPlanId: null, providerRef: null, paymentMethod: null, retryCount: 0, nextRetryAt: null, trialReminderSentAt: null, demoNextChargeFails: false, createdAt: "now", updatedAt: "now" },
  Invoice: { kind: "subscription", status: "OPEN", currency: "AZN", apply: null, paidAt: null, createdAt: "now" },
  Payment: { failureCode: null, createdAt: "now" },
  UsageCounter: { value: 0 },
  Counter: { value: 0 },
  PlatformExpense: { currency: "AZN", note: null, createdAt: "now" },
  Membership: { role: "EMPLOYEE", status: "INVITED", departmentId: null, title: null, permissions: [], inviteToken: null, invitedAt: null, joinedAt: null, createdAt: "now" },
  Department: { headId: null, parentId: null },
  Contact: { ownerId: null, type: "person", email: null, phone: null, companyName: null, stage: "LEAD", source: null, tags: [], customFields: {}, createdAt: "now", updatedAt: "now", deletedAt: null },
  Pipeline: { isDefault: false },
  PipelineStage: { probability: 0, kind: "open" },
  Deal: { contactId: null, ownerId: null, amount: 0, currency: "AZN", expectedClose: null, closedAt: null, lostReason: null, position: 0, createdAt: "now", updatedAt: "now" },
  Activity: { contactId: null, dealId: null, actorId: null, createdAt: "now" },
  Project: { ownerId: null, archived: false, createdAt: "now" },
  Task: { projectId: null, parentId: null, description: null, status: "TODO", priority: "MEDIUM", assigneeId: null, dueAt: null, completedAt: null, overdueNotifiedAt: null, recurrence: null, contactId: null, dealId: null, position: 0, createdAt: "now", updatedAt: "now" },
  TaskComment: { createdAt: "now" },
  Channel: { credentials: null, demo: false, settings: {}, status: "connected", createdAt: "now" },
  Conversation: { contactId: null, displayName: null, handle: null, lastInboundAt: null, status: "OPEN", assigneeId: null, departmentId: null, unreadCount: 0, lastMessageAt: null, awaitingSince: null, firstResponseMs: null, subject: null, emailReplyTo: null, createdAt: "now" },
  Message: { authorId: null, body: null, attachments: [], externalId: null, deliveryStatus: null, createdAt: "now" },
  CannedResponse: { isShared: true, ownerId: null },
  WebhookEvent: { receivedAt: "now", processedAt: null, error: null },
  ChatRoom: { name: null, departmentId: null, directKey: null, createdById: null, createdAt: "now" },
  ChatMember: { lastReadAt: null },
  ChatMessage: { body: null, attachments: [], taskId: null, createdAt: "now", editedAt: null },
  FileObject: { entityType: null, entityId: null, createdAt: "now" },
  Notification: { readAt: null, createdAt: "now" },
  AuditLog: { tenantId: null, actorId: null, diff: null, ip: null, createdAt: "now" },
  SupportTicket: { status: "open", priority: "MEDIUM", createdAt: "now", updatedAt: "now" },
  SupportTicketMessage: { fromStaff: false, createdAt: "now" },
  AutomationRule: { conditions: {}, enabled: true, rrCursor: 0, runCount: 0, lastRunAt: null, lastError: null, createdAt: "now", updatedAt: "now" },
  AutomationEvent: { status: "pending", attempts: 0, error: null, createdAt: "now", processedAt: null },
  AutomationRun: { detail: null, createdAt: "now" },
  PasswordReset: { usedAt: null, ip: null, createdAt: "now" },
  EmailMessage: { tenantId: null, inboxMessageId: null, from: null, headers: {}, status: "queued", attempts: 0, error: null, createdAt: "now", sentAt: null },
};

/** Models whose `updatedAt` is bumped on every update. */
export const HAS_UPDATED_AT: ReadonlySet<ModelName> = new Set<ModelName>(["User", "Tenant", "Plan", "Subscription", "Contact", "Deal", "Task", "SupportTicket", "AutomationRule"]);

/** Models that carry `tenantId` (tenant-isolated by the repository layer). Session is not: refresh tokens are looked up by hash before any identity exists. */
export const TENANT_MODELS: ReadonlySet<ModelName> = new Set<ModelName>(["Subscription", "Invoice", "Payment", "UsageCounter", "Membership", "Department", "Contact", "Pipeline", "PipelineStage", "Deal", "Activity", "Project", "Task", "TaskComment", "Channel", "Conversation", "Message", "CannedResponse", "ChatRoom", "ChatMember", "ChatMessage", "FileObject", "Notification", "AuditLog", "SupportTicket", "SupportTicketMessage", "AutomationRule", "AutomationEvent", "AutomationRun", "EmailMessage"]);
