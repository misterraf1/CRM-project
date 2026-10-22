import "./load-env.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { provision, startPostgres } from "./pg.mjs";

// `npm run db:start` — local PostgreSQL in <repo>/.data/pg, migrated and seeded.
// Keep it running in its own terminal; Ctrl+C stops it. Data persists between runs.

const url = new URL(process.env.DIRECT_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/axis");
const appUrl = new URL(process.env.DATABASE_URL ?? "postgresql://axis_app:axis_app@localhost:5433/axis");
const port = Number(url.port || 5432);
const database = url.pathname.slice(1);
const dir = fileURLToPath(new URL("../../../.data/pg", import.meta.url));
const cwd = fileURLToPath(new URL("..", import.meta.url));

const server = await startPostgres({ dir, port });
await provision({ port, database, appPassword: decodeURIComponent(appUrl.password) });

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd, env: process.env });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
};
run("npx", ["prisma", "migrate", "deploy"]);
run("node", ["prisma/seed.mjs"]);

console.log(`\n✔ PostgreSQL ready on localhost:${port}/${database} (Ctrl+C to stop)\n`);

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
