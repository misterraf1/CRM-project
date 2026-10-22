import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config";
import { AppError } from "../common/errors";

// AES-256-GCM for provider credentials stored in Channel.credentials.
// Layout: 12-byte IV | 16-byte auth tag | ciphertext.

function key() {
  const k = config().CHANNEL_SECRET_KEY;
  if (!k) throw new AppError("CHANNEL_ERROR", "Server is not configured to store channel credentials (CHANNEL_SECRET_KEY)");
  return Buffer.from(k, "base64");
}

export function sealCredentials(value: Record<string, string>): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

export function openCredentials(sealed: Uint8Array): Record<string, string> {
  const buf = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8"));
}
