import { hash, verify } from "@node-rs/argon2";

// argon2id with library defaults (19 MiB, t=2) — OWASP recommended baseline.
export const hashPassword = (password: string) => hash(password);

// Verified against when the user doesn't exist, so response time doesn't reveal registered emails.
const DUMMY_HASH = hash("timing-equaliser-not-a-real-password");

export async function verifyPassword(passwordHash: string | null | undefined, password: string) {
  if (!passwordHash) {
    await verify(await DUMMY_HASH, password).catch(() => false);
    return false;
  }
  return verify(passwordHash, password).catch(() => false);
}
