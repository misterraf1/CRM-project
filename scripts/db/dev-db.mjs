import "./load-env.mjs";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runBackfills } from "./backfill.mjs";
import { ensureIndexes } from "./indexes.mjs";
import { startMongo } from "./mongo.mjs";

// `npm run db:start` — local MongoDB replica set in <repo>/.data/mongo, indexed and seeded.
// Keep it running in its own terminal; Ctrl+C stops it. Data persists between runs.

const url = new URL(process.env.DATABASE_URL ?? "mongodb://127.0.0.1:27018/axis?replicaSet=rs0&directConnection=true&w=majority&journal=true");
const port = Number(url.port || 27017);
const dir = fileURLToPath(new URL("../../../.data/mongo", import.meta.url));
const cwd = fileURLToPath(new URL("..", import.meta.url));

mkdirSync(dir, { recursive: true });
const server = await startMongo({ dir, port });
await ensureIndexes(url.toString());
await runBackfills(url.toString());

const seeded = spawnSync("node", ["prisma/seed.mjs"], { stdio: "inherit", cwd, env: process.env });
if (seeded.status !== 0) throw new Error("Seed failed");

console.log(`\n✔ MongoDB ready on ${url.host}${url.pathname} (Ctrl+C to stop)\n`);

const stop = async () => {
  await server.stop({ doCleanup: false });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
