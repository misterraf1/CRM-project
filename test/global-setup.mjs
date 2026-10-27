import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Fresh, throwaway MongoDB replica set per test run, with the production indexes.
export default async function globalSetup() {
  // Imported lazily: indexes.mjs has a top-level await (its CLI entry), and newer Node 22
  // lets Jest require() this file, which fails on a static graph with top-level await
  const { ensureIndexes } = await import("../scripts/db/indexes.mjs");
  const { mongoUrl, startMongo } = await import("../scripts/db/mongo.mjs");
  const port = 27019;
  const server = await startMongo({ port, persistent: false });
  process.env.DATABASE_URL = mongoUrl(port, "axis_test");
  await ensureIndexes(process.env.DATABASE_URL);

  const root = fileURLToPath(new URL("..", import.meta.url));
  execFileSync("node", ["--experimental-strip-types", "--no-warnings", "scripts/db/seed.mjs"], { cwd: root, env: { ...process.env, SEED_DEMO: "false" }, stdio: "pipe" });

  globalThis.__AXIS_DB__ = server;
}
