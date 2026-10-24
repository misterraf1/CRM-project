import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

// All MongoDB indexes, created idempotently. Prisma's `db push` is not used because
// unique fields that may be null need partial indexes: a plain unique index treats
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
  ["Department", { tenantId: 1, name: 1 }, { unique: true }],
  // CRM
  ["Contact", { tenantId: 1, stage: 1 }],
  ["Contact", { tenantId: 1, ownerId: 1 }],
  ["Contact", { tenantId: 1, phone: 1 }],
  ["Contact", { tenantId: 1, email: 1 }],
  ["Contact", { tenantId: 1, createdAt: -1 }],
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
  ["TaskComment", { taskId: 1, createdAt: 1 }],
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
