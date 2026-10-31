import { MongoClient } from "mongodb";

// MongoDB counterpart of schema migrations. The API expects every field of a model
// (src/server/db/models.ts) to be present, so every required field added to an
// existing model needs a backfill here. Each step is idempotent (only touches documents missing the field).

export const BACKFILLS = [
  // Phase 6 — billing
  ["Plan", { extraSeatPrice: 900, extraStorageGbPrice: 500 }],
  ["Subscription", { retryCount: 0, demoNextChargeFails: false, paymentMethod: null, nextRetryAt: null, trialReminderSentAt: null }],
  ["Invoice", { kind: "subscription", apply: null }],
  // Phase 8 — platform staff 2FA
  ["User", { mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [] }],
  // v2 Stage B — custom fields, company links, currencies
  ["Contact", { companyId: null }],
  ["Deal", { customFields: {} }],
  ["Tenant", { fxRates: {} }],
  // v2 Stage D — custom roles, plan limits, manual subscriptions
  ["Membership", { roleId: null }],
  ["Plan", { contactLimit: null, automationLimit: null }],
  ["Subscription", { limitOverrides: {}, featureGrants: [], complimentary: false }],
  // v2 Stage E — quotes and invoices
  ["Tenant", { docSettings: {} }],
  ["SalesDoc", { overdueNotifiedAt: null, approval: null }],
  ["Product", { components: [] }],
  // v2 Stage F — channels
  ["Conversation", { optedOutAt: null }],
  ["Contact", { messagingConsent: null }],
  ["Conversation", { lastAutoReplyAt: null }],
  ["Membership", { presence: "available", mutedNotifications: [] }],
  ["Tenant", { inboxSettings: null, securitySettings: null }],
  // v2 Stage G2 — reminders
  ["Task", { reminderMinutes: null, remindAt: null }],
  // v2 Stage H — automation signals, scoring, warranty, renewals
  ["Contact", { inactiveAlertedAt: null, score: null, scoreLevel: null, scoreReasons: [], scoredAt: null }],
  ["Conversation", { unansweredAlertedAt: null }],
  ["Product", { renewalMonths: null, priceTiers: [] }],
  ["Order", { warrantyMonths: null }],
  // v2 Stage I — forms, campaigns, portal
  ["Contact", { emailOptOutAt: null }],
  ["EmailMessage", { campaignId: null, contactId: null }],
  // v2 Stage J
  ["Membership", { savedReports: [] }],
  ["Tenant", { onboarding: { dismissedAt: null, templates: [], demo: null } }],
];

/**
 * Backfills computed from other fields. Deals got `baseAmount` (company currency) in v2:
 * amounts were always entered in the company currency, so the deal's currency becomes
 * the company's (new deals used to be saved as "AZN" whatever the company currency was).
 */
const COMPUTED = [
  // Stage H: last activity of each contact, from its timeline (and creation when it has none)
  async (db) => {
    let touched = 0;
    const latest = db.collection("Activity").aggregate([{ $match: { contactId: { $ne: null } } }, { $group: { _id: "$contactId", at: { $max: "$createdAt" } } }]);
    for await (const row of latest) {
      const res = await db.collection("Contact").updateOne({ _id: row._id, lastActivityAt: { $exists: false } }, { $set: { lastActivityAt: row.at } });
      touched += res.modifiedCount;
    }
    const rest = await db.collection("Contact").updateMany({ lastActivityAt: { $exists: false } }, [{ $set: { lastActivityAt: "$createdAt" } }]);
    return touched + rest.modifiedCount;
  },
  // Stage F: disconnected channels free their provider id so it can be connected again
  async (db) => {
    let touched = 0;
    for await (const c of db.collection("Channel").find({ status: "disconnected", externalId: { $not: /^disconnected:/ } }, { projection: { _id: 1, externalId: 1 } })) {
      const res = await db.collection("Channel").updateOne({ _id: c._id }, { $set: { externalId: `disconnected:${c._id}:${c.externalId}` } });
      touched += res.modifiedCount;
    }
    return touched;
  },
  async (db) => {
    let touched = 0;
    for await (const t of db.collection("Tenant").find({}, { projection: { _id: 1, currency: 1 } })) {
      const res = await db
        .collection("Deal")
        .updateMany({ tenantId: t._id, baseAmount: { $exists: false } }, [{ $set: { baseAmount: "$amount", currency: t.currency ?? "AZN" } }]);
      touched += res.modifiedCount;
    }
    return touched;
  },
];

export async function runBackfills(url) {
  const client = new MongoClient(url);
  await client.connect();
  try {
    const db = client.db();
    let touched = 0;
    for (const [collection, defaults] of BACKFILLS) {
      for (const [field, value] of Object.entries(defaults)) {
        const res = await db.collection(collection).updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } });
        touched += res.modifiedCount;
      }
    }
    for (const step of COMPUTED) touched += await step(db);
    return touched;
  } finally {
    await client.close();
  }
}
