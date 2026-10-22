import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  TRIAL_DAYS: z.coerce.number().int().positive().default(14),
  /** Requests per minute per IP on auth endpoints */
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

/** Validated env, read once. Loads the monorepo root .env in development. */
export function config(): Config {
  if (cached) return cached;
  const rootEnv = resolve(__dirname, "../../../.env");
  if (process.env.NODE_ENV !== "production" && existsSync(rootEnv)) {
    const real = { ...process.env };
    process.loadEnvFile(rootEnv);
    Object.assign(process.env, real);
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
