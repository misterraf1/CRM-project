import { MongoMemoryReplSet } from "mongodb-memory-server";

// Real mongod binaries from npm (downloaded on first use), run as a single-node
// replica set — MongoDB transactions require one. Used by scripts/dev-db.mjs and
// the API e2e test setup, so development and tests need no Docker.

export const REPLICA_SET = "rs0";

export async function startMongo({ dir, port, persistent = true }) {
  const server = await MongoMemoryReplSet.create({
    replSet: { name: REPLICA_SET, count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port, ...(persistent ? { dbPath: dir } : {}) }],
  });
  await server.waitUntilRunning();
  return server;
}

/**
 * w=majority&journal=true: a write is acknowledged only once it is in the majority
 * snapshot that transactions read from. With the w:1 default a request right after
 * a write (e.g. the first call after signup) could miss it and see a stale state.
 */
export const mongoUrl = (port, database) =>
  `mongodb://127.0.0.1:${port}/${database}?replicaSet=${REPLICA_SET}&directConnection=true&w=majority&journal=true`;
