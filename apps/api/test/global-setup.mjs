import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { provision, startPostgres } from "../../../packages/db/scripts/pg.mjs";

// Fresh, throwaway PostgreSQL per test run: real RLS, real migrations.
export default async function globalSetup() {
  const port = 55433;
  const dir = mkdtempSync(join(tmpdir(), "axis-pg-"));
  const server = await startPostgres({ dir, port, persistent: false });
  await provision({ port, database: "axis_test", appPassword: "axis_app" });

  process.env.DATABASE_URL = `postgresql://axis_app:axis_app@localhost:${port}/axis_test`;
  process.env.DIRECT_DATABASE_URL = `postgresql://postgres:postgres@localhost:${port}/axis_test`;

  const dbDir = fileURLToPath(new URL("../../../packages/db", import.meta.url));
  const env = { ...process.env, SEED_DEMO: "false" };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: dbDir, env, stdio: "pipe" });
  execFileSync("node", ["prisma/seed.mjs"], { cwd: dbDir, env, stdio: "pipe" });

  globalThis.__AXIS_PG__ = server;
}
