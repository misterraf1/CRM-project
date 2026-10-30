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
export type ChannelType = "WHATSAPP" | "INSTAGRAM" | "MESSENGER" | "TELEGRAM" | "WEBCHAT" | "EMAIL";
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
  /** Company-currency value of one unit of another currency (CRM deals), e.g. { USD: 1.7 } */
  fxRates: Record<string, number>;
  /** Business hours, away reply and response target of the inbox (null = defaults) */
  inboxSettings: import("@/shared").InboxSettings | null;
  /** Seller details printed on quotes and invoices */
  docSettings: {
    legalName?: string | null;
    taxId?: string | null;
    address?: string | null;
    bankDetails?: string | null;
    terms?: string | null;
    /** data: URI of a PNG/JPEG/WebP logo (small, inlined so printed and public pages need no extra request) */
    logo?: string | null;
    /** Discount above this (basis points) needs approval; null = no limit */
    maxDiscountBp?: number | null;
    /** Default execution steps of a new order */
    orderSteps?: string[];
  };
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
  /** People and companies a tenant may keep; null = unlimited */
  contactLimit: number | null;
  /** Automation rules a tenant may keep; null = unlimited */
  automationLimit: number | null;
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
  /** Platform-set limits for this company in place of the plan's (a missing key = the plan's value) */
  limitOverrides: LimitOverrides;
  /** Features on top of the plan, optionally until a date */
  featureGrants: { feature: string; until: Date | null }[];
  /** Given for free by the platform: counts as no revenue */
  complimentary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LimitOverrides {
  seatLimit?: number;
  storageMb?: number;
  aiCredits?: number;
  /** null = unlimited */
  contactLimit?: number | null;
  automationLimit?: number | null;
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
  /** Custom role: its permissions replace the built-in role's (`role` is then EMPLOYEE) */
  roleId: string | null;
  /** Operator status: "away" members are skipped by automatic assignment */
  presence: "available" | "away";
  /** Notification types this member turned off */
  mutedNotifications: string[];
  status: MemberStatus;
  departmentId: string | null;
  title: string | null;
  permissions: string[];
  inviteToken: string | null;
  invitedAt: Date | null;
  joinedAt: Date | null;
  createdAt: Date;
}

/** A company's own role: a named set of permissions. */
export interface Role {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
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
  companyId: string | null;
  stage: LifecycleStage;
  source: string | null;
  tags: string[];
  customFields: JsonValue;
  /** Permission for messages we start (WhatsApp templates, campaigns): who recorded it and how */
  messagingConsent: { status: "opted_in" | "opted_out"; at: Date; source: "manual" | "keyword" } | null;
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
  /** `amount` in the company currency, minor units — every report sums this */
  baseAmount: number;
  customFields: JsonValue;
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
  /** The customer wrote STOP (or staff recorded it): no business-initiated messages */
  optedOutAt: Date | null;
  /** Last automatic out-of-hours reply (at most one per 12 h) */
  lastAutoReplyAt: Date | null;
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

export interface FieldDefinition {
  id: string;
  tenantId: string;
  entity: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  order: number;
  archived: boolean;
  createdAt: Date;
}

/** Unexpected server errors (API 500s, failed job runs), grouped by fingerprint. Platform-level. */
export interface ErrorEvent {
  id: string;
  fingerprint: string;
  source: string;
  message: string;
  stack: string | null;
  /** "GET /v1/deals" for API errors, the job name for jobs */
  where: string | null;
  /** The company whose request failed — a reference only, the row is platform data */
  tenantRef: string | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** One finished file import: what was asked, what happened, and the rows that weren't imported. */
export interface ImportJob {
  id: string;
  tenantId: string;
  entity: string;
  fileName: string;
  duplicates: string;
  rows: number;
  headers: string[];
  mapping: string[];
  summary: { create: number; update: number; skip: number; failed: number; companies: number };
  issues: JsonValue;
  issueRows: JsonValue;
  /** Records the import created (for tracing them back, and a future undo) */
  createdIds: string[];
  byId: string | null;
  createdAt: Date;
}

/** Commercial document line, with its computed amounts (minor units). */
export interface DocLine {
  productId: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountBp: number;
  taxBp: number;
  net: number;
  discount: number;
  tax: number;
  total: number;
}

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string;
  price: number;
  currency: string;
  taxBp: number;
  active: boolean;
  /** A bundle lists what it contains (sold at its own price, as one line) */
  components: { productId: string; quantity: number }[];
  createdAt: Date;
  updatedAt: Date;
}

/** A quote or a customer invoice (one collection: invoices are usually made from quotes). */
export interface SalesDoc {
  id: string;
  tenantId: string;
  kind: "quote" | "invoice";
  /** Quotes get one when created; invoices when issued (gap-free) */
  number: string | null;
  status: string;
  contactId: string;
  dealId: string | null;
  ownerId: string | null;
  /** The quote an invoice was made from */
  sourceId: string | null;
  currency: string;
  lines: DocLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  /** `total` in the company currency */
  baseTotal: number;
  paidAmount: number;
  issueDate: Date | null;
  /** Quote: valid until · invoice: due */
  dueDate: Date | null;
  notes: string | null;
  /** sha256 of the customer link's secret */
  publicToken: string | null;
  sentAt: Date | null;
  /** When the owner was told the invoice is overdue (once) */
  overdueNotifiedAt: Date | null;
  /** Discount over the company limit: a manager's decision before the quote goes out */
  approval: { status: "pending" | "approved" | "rejected"; requestedById: string | null; decidedById: string | null; at: Date; note: string | null } | null;
  response: { decision: "accept" | "reject"; name: string; comment: string | null; at: Date } | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderStep {
  id: string;
  title: string;
  assigneeId: string | null;
  dueDate: Date | null;
  doneAt: Date | null;
  doneById: string | null;
}

/** Work after the sale: execution steps with owners and dates. */
export interface Order {
  id: string;
  tenantId: string;
  number: string;
  title: string;
  status: string;
  contactId: string;
  dealId: string | null;
  quoteId: string | null;
  ownerId: string | null;
  currency: string;
  total: number;
  dueDate: Date | null;
  deliveryDate: Date | null;
  notes: string | null;
  steps: OrderStep[];
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocPayment {
  id: string;
  tenantId: string;
  docId: string;
  amount: number;
  method: string;
  paidOn: Date;
  reference: string | null;
  note: string | null;
  recordedById: string | null;
  createdAt: Date;
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
  Role: Role;
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
  ErrorEvent: ErrorEvent;
  FieldDefinition: FieldDefinition;
  ImportJob: ImportJob;
  Product: Product;
  SalesDoc: SalesDoc;
  DocPayment: DocPayment;
  Order: Order;
}
export type ModelName = keyof Models;

/** Filled in on insert when a field is left out: schema defaults, `null` for optional fields, `[]` for lists ("now" = current time). */
export const DEFAULTS: { [M in ModelName]: Partial<Record<keyof Models[M], unknown>> } = {
  User: { passwordHash: null, avatarUrl: null, locale: "AZ", platformRole: "NONE", emailVerified: null, mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [], lastLoginAt: null, createdAt: "now", updatedAt: "now" },
  AdminSession: { revokedAt: null, ip: null, userAgent: null, createdAt: "now" },
  Session: { userAgent: null, ip: null, rotatedAt: null, revokedAt: null, createdAt: "now" },
  Tenant: { logoUrl: null, timezone: "Asia/Baku", currency: "AZN", fxRates: {}, docSettings: {}, inboxSettings: null, locale: "AZ", status: "TRIALING", lockVersion: 0, createdAt: "now", updatedAt: "now" },
  Plan: { currency: "AZN", aiCredits: 0, extraSeatPrice: 900, extraStorageGbPrice: 500, features: [], contactLimit: null, automationLimit: null, isPublic: true, sortOrder: 0, createdAt: "now", updatedAt: "now" },
  Subscription: { status: "TRIALING", interval: "MONTH", extraSeats: 0, extraStorageMb: 0, trialEndsAt: null, graceEndsAt: null, cancelAtPeriodEnd: false, scheduledPlanId: null, providerRef: null, paymentMethod: null, retryCount: 0, nextRetryAt: null, trialReminderSentAt: null, demoNextChargeFails: false, limitOverrides: {}, featureGrants: [], complimentary: false, createdAt: "now", updatedAt: "now" },
  Invoice: { kind: "subscription", status: "OPEN", currency: "AZN", apply: null, paidAt: null, createdAt: "now" },
  Payment: { failureCode: null, createdAt: "now" },
  UsageCounter: { value: 0 },
  Counter: { value: 0 },
  PlatformExpense: { currency: "AZN", note: null, createdAt: "now" },
  Membership: { role: "EMPLOYEE", roleId: null, presence: "available", mutedNotifications: [], status: "INVITED", departmentId: null, title: null, permissions: [], inviteToken: null, invitedAt: null, joinedAt: null, createdAt: "now" },
  Role: { description: null, permissions: [], createdAt: "now", updatedAt: "now" },
  Department: { headId: null, parentId: null },
  Contact: { ownerId: null, type: "person", email: null, phone: null, companyName: null, companyId: null, stage: "LEAD", source: null, tags: [], customFields: {}, messagingConsent: null, createdAt: "now", updatedAt: "now", deletedAt: null },
  Pipeline: { isDefault: false },
  PipelineStage: { probability: 0, kind: "open" },
  Deal: { contactId: null, ownerId: null, amount: 0, currency: "AZN", baseAmount: 0, customFields: {}, expectedClose: null, closedAt: null, lostReason: null, position: 0, createdAt: "now", updatedAt: "now" },
  Activity: { contactId: null, dealId: null, actorId: null, createdAt: "now" },
  Project: { ownerId: null, archived: false, createdAt: "now" },
  Task: { projectId: null, parentId: null, description: null, status: "TODO", priority: "MEDIUM", assigneeId: null, dueAt: null, completedAt: null, overdueNotifiedAt: null, recurrence: null, contactId: null, dealId: null, position: 0, createdAt: "now", updatedAt: "now" },
  TaskComment: { createdAt: "now" },
  Channel: { credentials: null, demo: false, settings: {}, status: "connected", createdAt: "now" },
  Conversation: { contactId: null, displayName: null, handle: null, lastInboundAt: null, status: "OPEN", assigneeId: null, departmentId: null, unreadCount: 0, lastMessageAt: null, awaitingSince: null, firstResponseMs: null, subject: null, emailReplyTo: null, optedOutAt: null, lastAutoReplyAt: null, createdAt: "now" },
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
  FieldDefinition: { options: [], required: false, order: 0, archived: false, createdAt: "now" },
  ImportJob: { issues: [], issueRows: [], createdIds: [], byId: null, createdAt: "now" },
  Product: { sku: null, description: null, unit: "ədəd", taxBp: 0, active: true, components: [], createdAt: "now", updatedAt: "now" },
  Order: { status: "new", dealId: null, quoteId: null, ownerId: null, currency: "AZN", total: 0, dueDate: null, deliveryDate: null, notes: null, steps: [], completedAt: null, createdAt: "now", updatedAt: "now" },
  SalesDoc: { number: null, dealId: null, ownerId: null, sourceId: null, paidAmount: 0, issueDate: null, dueDate: null, notes: null, publicToken: null, sentAt: null, overdueNotifiedAt: null, approval: null, response: null, createdById: null, createdAt: "now", updatedAt: "now" },
  DocPayment: { reference: null, note: null, recordedById: null, createdAt: "now" },
  ErrorEvent: { stack: null, where: null, tenantRef: null, count: 1, firstSeenAt: "now", lastSeenAt: "now" },
};

/** Models whose `updatedAt` is bumped on every update. */
export const HAS_UPDATED_AT: ReadonlySet<ModelName> = new Set<ModelName>(["User", "Tenant", "Plan", "Subscription", "Role", "Contact", "Deal", "Task", "SupportTicket", "AutomationRule", "Product", "SalesDoc", "Order"]);

/** Models that carry `tenantId` (tenant-isolated by the repository layer). Session is not: refresh tokens are looked up by hash before any identity exists. */
export const TENANT_MODELS: ReadonlySet<ModelName> = new Set<ModelName>(["Subscription", "Invoice", "Payment", "UsageCounter", "Membership", "Role", "Department", "Contact", "Pipeline", "PipelineStage", "Deal", "Activity", "Project", "Task", "TaskComment", "Channel", "Conversation", "Message", "CannedResponse", "ChatRoom", "ChatMember", "ChatMessage", "FileObject", "Notification", "AuditLog", "SupportTicket", "SupportTicketMessage", "AutomationRule", "AutomationEvent", "AutomationRun", "EmailMessage", "FieldDefinition", "ImportJob", "Product", "SalesDoc", "DocPayment", "Order"]);
