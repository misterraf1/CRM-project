import type { ApiError, ErrorCode } from "@/shared";
import { config } from "../config";
import { requestContext } from "../common/context";
import { AppError } from "../common/errors";
import { isDuplicateKey } from "../db/errors";
import { TenantGuardError } from "../db/repo";
import { Logger } from "../common/logger";
import type { AuthGuard } from "../auth/auth.guard";
import type { AdminGuard } from "../admin/admin.guard";
import type { HandlerContext, Route, Router } from "./router";
import type { Throttler } from "./throttle";

const JSON_LIMIT = 1024 * 1024;

export interface ClientInfo {
  /** The browser's IP (rate limits, sessions, audit) */
  ip?: string;
}

const logger = new Logger("Error");

const errorResponse = (status: number, code: ErrorCode, message: string, details?: unknown) =>
  Response.json({ error: details === undefined ? { code, message } : { code, message, details } } satisfies ApiError, {
    status,
    headers: { "x-content-type-options": "nosniff" },
  });

/** Every error leaves the API as `{ error: { code, message, details? } }`. */
function toErrorResponse(e: unknown): Response {
  if (e instanceof AppError) return errorResponse(e.status, e.code, e.message, e.details);
  if (isDuplicateKey(e)) return errorResponse(409, "CONFLICT", "Already exists", { fields: Object.keys(e.keyPattern ?? {}) });
  if (e instanceof TenantGuardError) logger.error(`Tenant guard: ${e.message}`);
  logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  return errorResponse(500, "INTERNAL", "Internal server error");
}

function parseOrFail<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { flatten(): { fieldErrors: unknown } } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION_FAILED", "Invalid request body", result.error.flatten().fieldErrors);
  return result.data;
}

function queryObject(search: URLSearchParams) {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of search) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

async function readBody(req: Request, limit: number): Promise<Buffer> {
  if (req.method === "GET" || req.method === "HEAD" || !req.body) return Buffer.alloc(0);
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > limit) throw new AppError("FILE_TOO_LARGE", "Request body too large");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > limit) throw new AppError("FILE_TOO_LARGE", "Request body too large");
  return buf;
}

/**
 * The API as a fetch handler: `Request` in, `Response` out. Next.js route handlers
 * call it in-process (the BFF proxy, server components, webhooks); tests serve it
 * over a real HTTP socket.
 */
export class ApiApp {
  constructor(
    private readonly router: Router,
    private readonly throttler: Throttler,
    private readonly auth: AuthGuard,
    private readonly admin: AdminGuard,
  ) {}

  handle(req: Request, client: ClientInfo = {}): Promise<Response> {
    const url = new URL(req.url);
    return requestContext.run({ method: req.method, ip: client.ip, userAgent: req.headers.get("user-agent")?.slice(0, 255) }, async () => {
      try {
        let found: ReturnType<Router["match"]>;
        try {
          found = this.router.match(req.method, url.pathname);
        } catch {
          throw new AppError("VALIDATION_FAILED", "Malformed URL");
        }
        if (!found.route) throw new AppError("NOT_FOUND", `Cannot ${req.method} ${url.pathname}`);
        return await this.run(found.route, found.params, req, url, client);
      } catch (e) {
        return toErrorResponse(e);
      }
    });
  }

  private async run(route: Route, params: Record<string, string>, req: Request, url: URL, client: ClientInfo): Promise<Response> {
    const o = route.options;
    // Same order as before: rate limit, then identity, then input validation
    if (o.throttle !== false) this.throttler.check(route.id, req, client.ip, o.throttle);
    if (o.admin) await this.admin.check(req, o);
    else if (!o.public) await this.auth.check(req, o);

    const raw = await readBody(req, o.upload ? (config().MAX_UPLOAD_MB + 1) * 1024 * 1024 : JSON_LIMIT);
    const contentType = req.headers.get("content-type") ?? "";
    let body: unknown = {};
    let file: HandlerContext["file"];
    const fields: Record<string, string> = {};

    if (o.upload) {
      const form = contentType.startsWith("multipart/form-data")
        ? await new Response(raw, { headers: { "content-type": contentType } }).formData().catch(() => null)
        : null;
      for (const [name, value] of form ?? []) {
        if (typeof value === "string") fields[name] = value;
        else if (name === "file" && !file) {
          if (value.size > config().MAX_UPLOAD_MB * 1024 * 1024) throw new AppError("FILE_TOO_LARGE", "File too large");
          file = { originalname: value.name, mimetype: value.type, size: value.size, buffer: Buffer.from(await value.arrayBuffer()) };
        }
      }
      body = fields;
    } else if (raw.length && contentType.includes("json")) {
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new AppError("VALIDATION_FAILED", "Malformed JSON body");
      }
    }

    const query = o.query ? parseOrFail(o.query, queryObject(url.searchParams)) : queryObject(url.searchParams);
    if (o.body) body = parseOrFail(o.body, body);

    const result = await route.handler({ req, params, body, query, search: url.searchParams, raw, file, fields });
    if (result instanceof Response) return result;

    const status = o.status ?? (req.method === "POST" ? 201 : 200);
    const headers = new Headers({ "x-content-type-options": "nosniff", ...o.headers });
    if (status === 204 || result === undefined || result === null) return new Response(null, { status, headers });
    if (typeof result === "string") {
      if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");
      return new Response(result, { status, headers });
    }
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(result), { status, headers });
  }
}
