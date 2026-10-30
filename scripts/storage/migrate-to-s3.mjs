import "../db/load-env.mjs";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

// Copies every upload from the local storage directory to the S3-compatible bucket,
// keeping the same keys (`tenants/<tenantId>/<id>`), so FileObject rows need no change.
// Idempotent: objects already in the bucket are skipped. Local files are never deleted.
// Usage: npm run storage:migrate [-- --dry-run]

const dryRun = process.argv.includes("--dry-run");
const env = process.env;
for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
  if (!env[key]) {
    console.error(`${key} is not set`);
    process.exit(1);
  }
}
const root = resolve(env.FILE_STORAGE_DIR ?? ".data/files");
const s3 = new S3Client({
  region: env.S3_REGION ?? "auto",
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

let copied = 0;
let skipped = 0;
for await (const file of walk(root)) {
  const key = relative(root, file).split(sep).join("/");
  if (await exists(key)) {
    skipped += 1;
    continue;
  }
  if (!dryRun) await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: await readFile(file), ContentType: "application/octet-stream" }));
  copied += 1;
  console.log(`${dryRun ? "would copy" : "copied"} ${key}`);
}
console.log(`${dryRun ? "Dry run: " : ""}${copied} copied, ${skipped} already in the bucket (from ${root})`);
