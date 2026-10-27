import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Time-based one-time passwords (RFC 6238: HMAC-SHA1, 30 s steps, 6 digits) — what
// Google Authenticator, Microsoft Authenticator and 1Password generate.

const STEP_SEC = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32 (the form authenticator apps expect). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, "0");
}

export const totpStep = (at = Date.now()) => Math.floor(at / 1000 / STEP_SEC);

export const totp = (secret: string, at = Date.now()) => hotp(secret, totpStep(at));

/**
 * Checks a code against the current step ±1 (clock drift). Returns the matched step so
 * the caller can refuse to accept the same code twice; null when it doesn't match.
 */
export function verifyTotp(secret: string, code: string, at = Date.now()): number | null {
  const given = Buffer.from(code.replace(/\s/g, ""));
  if (given.length !== DIGITS) return null;
  const now = totpStep(at);
  for (const step of [now, now - 1, now + 1]) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, given)) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`;
}
