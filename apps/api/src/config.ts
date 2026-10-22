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
  /**
   * Which hops may set X-Forwarded-For (Express "trust proxy"). The web BFF calls the
   * API from the same host/private network and forwards the browser's IP, so rate
   * limits apply per real client. Never trust arbitrary internet hops.
   */
  TRUST_PROXY: z.string().default("loopback, linklocal, uniquelocal"),
  /** Where the local storage driver keeps uploads (S3 driver: Phase 7 deployment) */
  FILE_STORAGE_DIR: z.string().default(resolve(__dirname, "../../../.data/files")),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  /** Background jobs (overdue notices). Off in tests, which trigger jobs explicitly. */
  JOBS_ENABLED: z
    .enum(["true", "false"])
    .default(process.env.NODE_ENV === "test" ? "false" : "true")
    .transform((v) => v === "true"),
  /** 32 bytes, base64. Encrypts channel credentials (provider access tokens) at rest. */
  CHANNEL_SECRET_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "CHANNEL_SECRET_KEY must be 32 bytes, base64")
    .optional(),
  /** Meta app (WhatsApp Cloud API, Messenger, Instagram). Webhooks are rejected without the secret. */
  META_APP_SECRET: z.string().min(16).optional(),
  META_VERIFY_TOKEN: z.string().min(8).optional(),
  META_GRAPH_URL: z.string().url().default("https://graph.facebook.com/v21.0"),
  /**
   * Payment provider. Only "demo" exists today: a hosted page on our own web app,
   * clearly labelled, that charges nothing. Payriff / Epoint plug in as providers.
   */
  BILLING_PROVIDER: z.enum(["demo"]).default("demo"),
  GRACE_DAYS: z.coerce.number().int().positive().default(7),
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
