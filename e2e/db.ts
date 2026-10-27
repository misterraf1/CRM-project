import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// Direct database access for test setup the UI can't do (creating platform staff).
// Same root .env the API uses; real env vars win.
const rootEnv = resolve(__dirname, "../../../.env");
if (existsSync(rootEnv)) {
  const before = { ...process.env };
  process.loadEnvFile(rootEnv);
  Object.assign(process.env, before);
}

export async function withDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient();
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}
