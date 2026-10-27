import type { Feature, Permission } from "@/shared";
import type { ZodTypeAny, z } from "zod";
import type { UploadedFile } from "../tasks/files.service";

/**
 * Route table of the API. Each route declares its access rules next to its path,
 * the way the controllers' decorators did:
 *  - signed-in company member by default (`public` skips it, `admin` uses the platform session)
 *  - `permission` / `feature` / `allowInactive` checked by the AuthGuard
 *  - `body` / `query` validated with zod before the handler runs
 *  - `throttle` overrides the default per-route rate limit (`false` turns it off)
 */
export interface RouteOptions<B extends ZodTypeAny | undefined = undefined, Q extends ZodTypeAny | undefined = undefined> {
  body?: B;
  query?: Q;
  /** Success status; default 201 for POST, 200 otherwise */
  status?: number;
  /** Extra response headers (e.g. CSV export) */
  headers?: Record<string, string>;
  /** No company session needed (signup, login, invite links, widget, webhooks) */
  public?: boolean;
  /** Platform-staff session instead of a company one (Super Admin console) */
  admin?: boolean;
  superAdminOnly?: boolean;
  /** Reachable before 2FA is set up where it is mandatory */
  withoutMfa?: boolean;
  permission?: Permission;
  feature?: Feature;
  /** Writes allowed even while the subscription is suspended/canceled */
  allowInactive?: boolean;
  throttle?: { limit: number | (() => number); ttl: number } | false;
  /** multipart/form-data with one `file` field (plus text fields) */
  upload?: boolean;
}

type Infer<S> = S extends ZodTypeAny ? z.infer<S> : unknown;

export interface HandlerContext<B = unknown, Q = unknown> {
  req: Request;
  params: Record<string, string>;
  body: B;
  query: Q;
  /** Raw query string values (for routes without a query schema) */
  search: URLSearchParams;
  /** Request body bytes (webhook signatures) */
  raw: Buffer;
  file?: UploadedFile;
  /** Text fields of a multipart request */
  fields: Record<string, string>;
}

export type Handler<B = unknown, Q = unknown> = (ctx: HandlerContext<B, Q>) => unknown;

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface Route {
  id: string;
  method: Method;
  path: string;
  pattern: RegExp;
  keys: string[];
  options: RouteOptions<ZodTypeAny | undefined, ZodTypeAny | undefined>;
  handler: Handler<unknown, unknown>;
}

const compile = (path: string) => {
  const keys: string[] = [];
  const source = path
    .split("/")
    .map((part) => {
      if (!part.startsWith(":")) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      keys.push(part.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { keys, pattern: new RegExp(`^${source}/?$`, "i") };
};

/** A prefix plus options shared by its routes (what a controller class was). */
export class RouteGroup {
  constructor(
    private readonly routes: Route[],
    private readonly prefix: string,
    private readonly defaults: RouteOptions<undefined, undefined>,
  ) {}

  get<Q extends ZodTypeAny | undefined = undefined>(path: string, options: RouteOptions<undefined, Q>, handler: Handler<unknown, Infer<Q>>): void;
  get(path: string, handler: Handler): void;
  get(path: string, a: unknown, b?: unknown) {
    this.add("GET", path, a, b);
  }

  post<B extends ZodTypeAny | undefined = undefined, Q extends ZodTypeAny | undefined = undefined>(
    path: string,
    options: RouteOptions<B, Q>,
    handler: Handler<Infer<B>, Infer<Q>>,
  ): void;
  post(path: string, handler: Handler): void;
  post(path: string, a: unknown, b?: unknown) {
    this.add("POST", path, a, b);
  }

  patch<B extends ZodTypeAny | undefined = undefined>(path: string, options: RouteOptions<B, undefined>, handler: Handler<Infer<B>>): void;
  patch(path: string, handler: Handler): void;
  patch(path: string, a: unknown, b?: unknown) {
    this.add("PATCH", path, a, b);
  }

  delete(path: string, options: RouteOptions, handler: Handler): void;
  delete(path: string, handler: Handler): void;
  delete(path: string, a: unknown, b?: unknown) {
    this.add("DELETE", path, a, b);
  }

  private add(method: Method, path: string, a: unknown, b: unknown) {
    const [options, handler] = (typeof a === "function" ? [{}, a] : [a, b]) as [RouteOptions<ZodTypeAny | undefined, ZodTypeAny | undefined>, Handler];
    const full = `${this.prefix}${path ? `/${path}` : ""}`;
    this.routes.push({
      id: `${method} ${full}`,
      method,
      path: full,
      ...compile(full),
      options: { ...this.defaults, ...options },
      handler,
    });
  }
}

export class Router {
  readonly routes: Route[] = [];

  /** Routes match in registration order, so static segments go before `:params`. */
  group(prefix: string, defaults: RouteOptions<undefined, undefined>, register: (r: RouteGroup) => void) {
    register(new RouteGroup(this.routes, prefix, defaults));
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | { route: null; allowed: boolean } {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
      return { route, params };
    }
    return { route: null, allowed: pathMatched };
  }
}
