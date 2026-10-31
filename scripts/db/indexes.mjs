import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

// All MongoDB indexes, created idempotently. Unique fields that may be null need
// partial indexes: a plain unique index treats
// every null as the same value (two memberships without an invite token would clash).

const nonNull = (...fields) => ({ partialFilterExpression: Object.fromEntries(fields.map((f) => [f, { $type: "string" }])) });

/** [collection, keys, options] */
export const INDEXES = [
  // Platform
  ["User", { email: 1 }, { unique: true }],
  ["Session", { tokenHash: 1 }, { unique: true }],
  ["Session", { userId: 1 }],
  ["Session", { familyId: 1 }],
  ["Tenant", { slug: 1 }, { unique: true }],
  ["Plan", { code: 1 }, { unique: true }],
  ["Subscription", { tenantId: 1 }, { unique: true }],
  ["Subscription", { status: 1, currentPeriodEnd: 1 }],
  ["Invoice", { number: 1 }, { unique: true }],
  ["Invoice", { tenantId: 1, createdAt: -1 }],
  ["Payment", { provider: 1, providerRef: 1 }, { unique: true }],
  ["UsageCounter", { tenantId: 1, metric: 1, period: 1 }, { unique: true }],
  ["WebhookEvent", { provider: 1, externalId: 1 }, { unique: true }],
  // Organisation
  ["Membership", { tenantId: 1, userId: 1 }, { unique: true }],
  ["Membership", { inviteToken: 1 }, { unique: true, ...nonNull("inviteToken") }],
  ["Membership", { tenantId: 1, departmentId: 1 }],
  ["Membership", { userId: 1 }],
  ["Membership", { tenantId: 1, roleId: 1 }],
  ["Role", { tenantId: 1, name: 1 }, { unique: true }],
  ["Department", { tenantId: 1, name: 1 }, { unique: true }],
  // CRM
  ["Contact", { tenantId: 1, stage: 1 }],
  ["Contact", { tenantId: 1, ownerId: 1 }],
  ["Contact", { tenantId: 1, phone: 1 }],
  ["Contact", { tenantId: 1, email: 1 }],
  ["Contact", { tenantId: 1, createdAt: -1 }],
  ["Contact", { tenantId: 1, companyId: 1 }],
  ["Contact", { tenantId: 1, tags: 1 }],
  ["FieldDefinition", { tenantId: 1, entity: 1, order: 1 }],
  ["ImportJob", { tenantId: 1, createdAt: -1 }],
  ["Product", { tenantId: 1, name: 1 }],
  ["SalesDoc", { tenantId: 1, kind: 1, createdAt: -1 }],
  ["SalesDoc", { tenantId: 1, dealId: 1 }],
  ["SalesDoc", { tenantId: 1, contactId: 1 }],
  ["SalesDoc", { tenantId: 1, kind: 1, number: 1 }, { unique: true, ...nonNull("number") }],
  ["SalesDoc", { publicToken: 1 }, { unique: true, ...nonNull("publicToken") }],
  ["DocPayment", { docId: 1, paidOn: 1 }],
  ["Order", { tenantId: 1, createdAt: -1 }],
  ["Order", { tenantId: 1, quoteId: 1 }],
  ["Order", { tenantId: 1, dealId: 1 }],
  ["Order", { tenantId: 1, number: 1 }, { unique: true }],
  ["PipelineStage", { pipelineId: 1, order: 1 }, { unique: true }],
  ["Deal", { tenantId: 1, stageId: 1 }],
  ["Deal", { tenantId: 1, ownerId: 1 }],
  ["Deal", { tenantId: 1, closedAt: 1 }],
  ["Activity", { tenantId: 1, createdAt: -1 }],
  ["Activity", { contactId: 1, createdAt: -1 }],
  ["Activity", { dealId: 1, createdAt: -1 }],
  // Tasks
  ["Task", { tenantId: 1, assigneeId: 1, status: 1 }],
  ["Task", { tenantId: 1, dueAt: 1 }],
  ["Task", { tenantId: 1, parentId: 1 }],
  ["Task", { dueAt: 1, overdueNotifiedAt: 1 }],
  ["Task", { remindAt: 1 }, { partialFilterExpression: { remindAt: { $type: "date" } } }],
  ["TaskComment", { taskId: 1, createdAt: 1 }],
  // Calendar
  ["CalendarEvent", { tenantId: 1, startAt: 1 }],
  ["CalendarEvent", { tenantId: 1, recurrence: 1 }],
  ["CalendarEvent", { tenantId: 1, contactId: 1, startAt: -1 }],
  ["CalendarEvent", { remindAt: 1 }, { partialFilterExpression: { remindAt: { $type: "date" } } }],
  // Stage H
  ["Contact", { tenantId: 1, lastActivityAt: 1 }],
  ["Contact", { tenantId: 1, scoreLevel: 1, score: -1 }],
  ["Contact", { scoredAt: 1 }],
  ["ServiceCase", { tenantId: 1, status: 1, dueAt: 1 }],
  ["ServiceCase", { tenantId: 1, contactId: 1, createdAt: -1 }],
  ["ServiceCase", { tenantId: 1, number: 1 }, { unique: true }],
  ["Renewal", { tenantId: 1, status: 1, dueAt: 1 }],
  ["Renewal", { tenantId: 1, docId: 1, productId: 1 }, { unique: true }],
  ["Renewal", { status: 1, taskId: 1, dueAt: 1 }],
  ["SalesTarget", { tenantId: 1, period: 1, start: 1, memberId: 1 }, { unique: true }],
  // Stage I
  ["WebForm", { tenantId: 1, createdAt: -1 }],
  ["Campaign", { tenantId: 1, createdAt: -1 }],
  ["EmailMessage", { campaignId: 1, status: 1 }, { partialFilterExpression: { campaignId: { $type: "string" } } }],
  ["PortalAccess", { tokenHash: 1 }, { unique: true }],
  ["PortalAccess", { tenantId: 1, contactId: 1 }],
  ["FileObject", { key: 1 }, { unique: true }],
  ["FileObject", { tenantId: 1, entityType: 1, entityId: 1 }],
  ["Notification", { memberId: 1, readAt: 1 }],
  ["AuditLog", { tenantId: 1, createdAt: -1 }],
  // Platform
  ["AdminSession", { userId: 1 }],
  ["SupportTicket", { tenantId: 1, updatedAt: -1 }],
  ["SupportTicket", { status: 1, updatedAt: -1 }],
  ["SupportTicketMessage", { ticketId: 1, createdAt: 1 }],
  ["Payment", { status: 1, createdAt: -1 }],
  ["PlatformExpense", { incurredOn: -1 }],
  // Automations
  ["AutomationRule", { tenantId: 1, trigger: 1, enabled: 1 }],
  ["AutomationEvent", { status: 1, createdAt: 1 }],
  ["AutomationRun", { ruleId: 1, createdAt: -1 }],
  // Email
  ["PasswordReset", { tokenHash: 1 }, { unique: true }],
  ["PasswordReset", { userId: 1, createdAt: -1 }],
  ["EmailMessage", { status: 1, createdAt: 1 }],
  ["EmailMessage", { tenantId: 1, createdAt: -1 }],
  ["ErrorEvent", { fingerprint: 1 }, { unique: true }],
  ["ErrorEvent", { lastSeenAt: -1 }],
  // Inbox
  ["Channel", { type: 1, externalId: 1 }, { unique: true }],
  ["Conversation", { channelId: 1, externalThread: 1 }, { unique: true }],
  ["Conversation", { tenantId: 1, status: 1, lastMessageAt: -1 }],
  ["Conversation", { tenantId: 1, assigneeId: 1 }],
  ["Message", { conversationId: 1, externalId: 1 }, { unique: true, ...nonNull("externalId") }],
  ["Message", { conversationId: 1, createdAt: 1 }],
  ["CannedResponse", { tenantId: 1, shortcut: 1 }, { unique: true }],
  // Team chat
  ["ChatRoom", { departmentId: 1 }, { unique: true, ...nonNull("departmentId") }],
  ["ChatRoom", { tenantId: 1, directKey: 1 }, { unique: true, ...nonNull("directKey") }],
  ["ChatMember", { roomId: 1, memberId: 1 }, { unique: true }],
  ["ChatMember", { tenantId: 1, memberId: 1 }],
  ["ChatMessage", { roomId: 1, createdAt: -1 }],
];

export async function ensureIndexes(url) {
  const client = new MongoClient(url);
  await client.connect();
  try {
    const db = client.db();
    for (const [collection, keys, options = {}] of INDEXES) {
      await db.collection(collection).createIndex(keys, options);
    }
    return INDEXES.length;
  } finally {
    await client.close();
  }
}

// `node scripts/indexes.mjs` with DATABASE_URL set (compare paths, not URLs: the
// repo path may contain spaces, which import.meta.url percent-encodes)
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  await import("./load-env.mjs");
  const { runBackfills } = await import("./backfill.mjs");
  const n = await ensureIndexes(process.env.DATABASE_URL);
  const b = await runBackfills(process.env.DATABASE_URL);
  console.log(`✔ ${n} indexes ensured, ${b} documents backfilled`);
}
