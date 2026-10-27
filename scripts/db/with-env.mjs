import "./load-env.mjs";
import { spawnSync } from "node:child_process";

// Usage: node scripts/with-env.mjs <command...> — runs it with the root .env loaded.
const [cmd, ...args] = process.argv.slice(2);
const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
