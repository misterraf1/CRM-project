import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AuthTokens, InviteCreatedResponse, MemberRole } from "@axis/shared";
import { createNullFill } from "@axis/db/null-fill";
import { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { hashPassword } from "../src/auth/password";
import { configureApp } from "../src/bootstrap";

export async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, rawBody: true });
  configureApp(app);
  // Listen once on IPv4 loopback. Otherwise supertest listens on an ephemeral port on
  // every interface per request but connects to 127.0.0.1 — when another local program
  // holds that port on IPv4, the request reaches it instead (random 401/404 failures).
  await app.listen(0, "127.0.0.1");
  return app;
}

let seq = 0;
export const uniqueEmail = (tag: string) => `${tag}.${Date.now().toString(36)}${seq++}@test.axis`;
export const PASSWORD = "Sup3r-secret!";

export interface Company {
  tokens: AuthTokens;
  email: string;
  auth: { authorization: string };
}

export async function signup(app: INestApplication, companyName = "Test Şirkət"): Promise<Company> {
  const email = uniqueEmail("owner");
  const res = await request(app.getHttpServer())
    .post("/v1/auth/signup")
    .send({ companyName, fullName: "Test Sahib", email, password: PASSWORD });
  if (res.status !== 201) throw new Error(`signup failed ${res.status}: ${JSON.stringify(res.body)}`);
  return { tokens: res.body, email, auth: { authorization: `Bearer ${res.body.accessToken}` } };
}

/** Invites and accepts in one go; returns the new member's auth header. */
export async function addMember(app: INestApplication, owner: Company, role: MemberRole) {
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
export async function withRawDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  db.$use(createNullFill(Prisma.dmmf));
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

export const setPlan = (tenantId: string, code: "START" | "PRO" | "BUSINESS") =>
  withRawDb(async (db) => {
    const plan = await db.plan.findUniqueOrThrow({ where: { code } });
    await db.subscription.update({ where: { tenantId }, data: { planId: plan.id } });
  });

/** Platform staff account (Super Admin / Support) signed in to the admin API. */
export async function platformStaff(app: INestApplication, role: "SUPER_ADMIN" | "SUPPORT") {
  const email = uniqueEmail(`staff-${role.toLowerCase()}`);
  const passwordHash = await hashPassword(PASSWORD);
  const user = await withRawDb((db) => db.user.create({ data: { email, fullName: `Staff ${role}`, passwordHash, platformRole: role } }));
  const res = await request(app.getHttpServer()).post("/v1/admin/auth/login").send({ email, password: PASSWORD }).expect(200);
  return { userId: user.id, email, auth: { authorization: `Bearer ${res.body.accessToken}` } };
}
