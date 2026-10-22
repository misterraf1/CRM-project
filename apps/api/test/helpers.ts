import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AuthTokens, InviteCreatedResponse, MemberRole } from "@axis/shared";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";

export async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, rawBody: true });
  configureApp(app);
  await app.init();
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
    .send({ companyName, fullName: "Test Sahib", email, password: PASSWORD })
    .expect(201);
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

/** Raw connection as the application role, to test RLS below the API. */
export async function appRoleClient() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/** Owner connection for test setup that the API itself cannot do (e.g. changing plans). */
export async function ownerClient() {
  const client = new Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  return client;
}
