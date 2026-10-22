import { MongoClient } from "mongodb";

// MongoDB counterpart of schema migrations. Prisma fails to read a document that
// lacks a required field, so every required field added to an existing model needs
// a backfill here. Each step is idempotent (only touches documents missing the field).

export const BACKFILLS = [
  // Phase 6 — billing
  ["Plan", { extraSeatPrice: 900, extraStorageGbPrice: 500 }],
  ["Subscription", { retryCount: 0, demoNextChargeFails: false, paymentMethod: null, nextRetryAt: null, trialReminderSentAt: null }],
  ["Invoice", { kind: "subscription", apply: null }],
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
    return touched;
  } finally {
    await client.close();
  }
}
