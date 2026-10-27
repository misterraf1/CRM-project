import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Database, type Tx } from "../src/server/db/database";

// Direct database access for test setup the UI can't do (creating platform staff).
// Same root .env the API uses; real env vars win.
const rootEnv = resolve(__dirname, "../.env");
if (existsSync(rootEnv)) {
  const before = { ...process.env };
  process.loadEnvFile(rootEnv);
  Object.assign(process.env, before);
}

/** Cross-tenant access (platform scope), like the seed script. */
export async function withDb<T>(fn: (db: Tx) => Promise<T>): Promise<T> {
  const db = new Database(process.env.DATABASE_URL!);
  try {
    return await fn(db.system);
  } finally {
    await db.close();
  }
}
