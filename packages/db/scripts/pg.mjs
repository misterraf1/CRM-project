import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

// Real PostgreSQL binaries from npm, so development and tests need no Docker.
// Used by scripts/dev-db.mjs and the API e2e test setup.

export const APP_ROLE = "axis_app";

export async function startPostgres({ dir, port, persistent = true }) {
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port,
    persistent,
    onLog: () => {},
    onError: (e) => console.error(String(e)),
  });
  const { existsSync } = await import("node:fs");
  if (!existsSync(`${dir}/PG_VERSION`)) await server.initialise();
  await server.start();
  return server;
}

/** Creates the database and the RLS-bound application role if missing. */
export async function provision({ port, database, appPassword }) {
  const admin = new pg.Client({ host: "localhost", port, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  try {
    const db = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (db.rowCount === 0) await admin.query(`CREATE DATABASE "${database}"`);
    const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE]);
    if (role.rowCount === 0) {
      await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${appPassword.replace(/'/g, "''")}'`);
    }
  } finally {
    await admin.end();
  }
}
