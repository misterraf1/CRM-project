import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Loads the monorepo root .env (if present) without overriding real env vars.
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) {
  const before = { ...process.env };
  process.loadEnvFile(rootEnv);
  Object.assign(process.env, before);
}
