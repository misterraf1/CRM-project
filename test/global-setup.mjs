import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Fresh, throwaway MongoDB replica set per test run, with the production indexes.
export default async function globalSetup() {
  // Imported lazily: indexes.mjs has a top-level await (its CLI entry), and newer Node 22
  // lets Jest require() this file, which fails on a static graph with top-level await
  const { ensureIndexes } = await import("../../../packages/db/scripts/indexes.mjs");
  const { mongoUrl, startMongo } = await import("../../../packages/db/scripts/mongo.mjs");
  const port = 27019;
  const server = await startMongo({ port, persistent: false });
  process.env.DATABASE_URL = mongoUrl(port, "axis_test");
  await ensureIndexes(process.env.DATABASE_URL);

  const dbDir = fileURLToPath(new URL("../../../packages/db", import.meta.url));
  execFileSync("node", ["prisma/seed.mjs"], { cwd: dbDir, env: { ...process.env, SEED_DEMO: "false" }, stdio: "pipe" });

  globalThis.__AXIS_DB__ = server;
}
