import { createHash, randomBytes } from "node:crypto";

/** Sortable, URL-safe id: time prefix + 80 random bits. */
export function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(10).toString("base64url")}`;
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
