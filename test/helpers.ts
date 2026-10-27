import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { AuthTokens, InviteCreatedResponse, MemberRole } from "@/shared";
import request from "supertest";
import { createApi } from "@/server";
import { Database, type Tx } from "@/server/db/database";
import { hashPassword } from "@/server/auth/password";

export interface TestApp {
  getHttpServer(): Server;
  /** The service instance of a class (e.g. `app.get(MailService)`), for jobs and fakes */
  get<T>(type: abstract new (...args: never[]) => T): T;
  close(): Promise<void>;
}

/** Node request → fetch Request → API → Node response, the way Next.js serves the route handlers. */
async function serve(api: ReturnType<typeof createApi>, req: IncomingMessage, res: ServerResponse) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const out = await api.handle(
    new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
      // @ts-expect-error Node's fetch needs this for a streamed request body
      duplex: hasBody ? "half" : undefined,
      signal: abort.signal,
    }),
    { ip: headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.socket.remoteAddress },
  );
  res.writeHead(out.status, Object.fromEntries(out.headers));
  if (!out.body) return res.end();
  Readable.fromWeb(out.body as import("node:stream/web").ReadableStream).on("error", () => res.destroy()).pipe(res);
}

export async function createApp(): Promise<TestApp> {
  const api = createApi();
  const server = createServer((req, res) => {
    serve(api, req, res).catch((e) => {
      res.statusCode = 500;
      res.end(String(e));
    });
  });
  // Listen once on IPv4 loopback. Otherwise supertest listens on an ephemeral port on
  // every interface per request but connects to 127.0.0.1 — when another local program
  // holds that port on IPv4, the request reaches it instead (random 401/404 failures).
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const instances = Object.values(api.services) as object[];
  return {
    getHttpServer: () => server,
    get<T>(type: abstract new (...args: never[]) => T) {
      const found = instances.find((i) => i instanceof type);
      if (!found) throw new Error(`No service ${type.name}`);
      return found as T;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await api.close();
    },
  };
}

let seq = 0;
export const uniqueEmail = (tag: string) => `${tag}.${Date.now().toString(36)}${seq++}@test.axis`;
export const PASSWORD = "Sup3r-secret!";

export interface Company {
  tokens: AuthTokens;
  email: string;
  auth: { authorization: string };
}

export async function signup(app: TestApp, companyName = "Test Şirkət"): Promise<Company> {
  const email = uniqueEmail("owner");
  const res = await request(app.getHttpServer())
    .post("/v1/auth/signup")
    .send({ companyName, fullName: "Test Sahib", email, password: PASSWORD });
  if (res.status !== 201) throw new Error(`signup failed ${res.status}: ${JSON.stringify(res.body)}`);
  return { tokens: res.body, email, auth: { authorization: `Bearer ${res.body.accessToken}` } };
}

/** Invites and accepts in one go; returns the new member's auth header. */
export async function addMember(app: TestApp, owner: Company, role: MemberRole) {
  const email = uniqueEmail(role.toLowerCase());
  const invite = await request(app.getHttpServer())
    .post("/v1/members/invites")
    .set(owner.auth)
    .send({ email, role, fullName: `Test ${role}` })
    .expect(201);
  const body = invite.body as InviteCreatedResponse;
  const token = body.invitePath.replace("/invite/", "");
  const accepted = await request(app.getHttpServer()).post(`/v1/invites/${token}/accept`).send({ password: PASSWORD }).expect(200);
  return { email, memberId: body.member.id, auth: { authorization: `Bearer ${accepted.body.accessToken}` } };
}

/**
 * Platform-level client without the tenant guard, for test setup the API can't do
 * (ageing timestamps, switching plans). Mirrors what the seed script uses.
 */
export async function withRawDb<T>(fn: (db: Tx) => Promise<T>): Promise<T> {
  const db = new Database(process.env.DATABASE_URL!);
  try {
    return await fn(db.system);
  } finally {
    await db.close();
  }
}

export const setPlan = (tenantId: string, code: "START" | "PRO" | "BUSINESS") =>
  withRawDb(async (db) => {
    const plan = await db.plan.get({ code });
    await db.subscription.update({ tenantId }, { $set: { planId: plan.id } });
  });

/** Platform staff account (Super Admin / Support) signed in to the admin API. */
export async function platformStaff(app: TestApp, role: "SUPER_ADMIN" | "SUPPORT") {
  const email = uniqueEmail(`staff-${role.toLowerCase()}`);
  const passwordHash = await hashPassword(PASSWORD);
  const user = await withRawDb((db) => db.user.insertOne({ email, fullName: `Staff ${role}`, passwordHash, platformRole: role }));
  const res = await request(app.getHttpServer()).post("/v1/admin/auth/login").send({ email, password: PASSWORD }).expect(200);
  return { userId: user.id, email, auth: { authorization: `Bearer ${res.body.accessToken}` } };
}
