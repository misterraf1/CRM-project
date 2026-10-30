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
];

/**
 * Backfills computed from other fields. Deals got `baseAmount` (company currency) in v2:
 * amounts were always entered in the company currency, so the deal's currency becomes
 * the company's (new deals used to be saved as "AZN" whatever the company currency was).
 */
const COMPUTED = [
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
