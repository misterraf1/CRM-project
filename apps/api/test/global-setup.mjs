import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureIndexes } from "../../../packages/db/scripts/indexes.mjs";
import { mongoUrl, startMongo } from "../../../packages/db/scripts/mongo.mjs";

// Fresh, throwaway MongoDB replica set per test run, with the production indexes.
export default async function globalSetup() {
  const port = 27019;
  const server = await startMongo({ port, persistent: false });
  process.env.DATABASE_URL = mongoUrl(port, "axis_test");
  await ensureIndexes(process.env.DATABASE_URL);

  const dbDir = fileURLToPath(new URL("../../../packages/db", import.meta.url));
  execFileSync("node", ["prisma/seed.mjs"], { cwd: dbDir, env: { ...process.env, SEED_DEMO: "false" }, stdio: "pipe" });

  globalThis.__AXIS_DB__ = server;
}
