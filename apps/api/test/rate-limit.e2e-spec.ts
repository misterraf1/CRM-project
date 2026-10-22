import type { INestApplication } from "@nestjs/common";
import request from "supertest";

describe("Rate limiting", () => {
  let app: INestApplication;
  const previous = process.env.AUTH_RATE_LIMIT;

  beforeAll(async () => {
    // config() is cached on first import, so load a fresh module graph after changing env
    jest.resetModules();
    process.env.AUTH_RATE_LIMIT = "3";
    app = await (await import("./helpers")).createApp();
  });
  afterAll(async () => {
    process.env.AUTH_RATE_LIMIT = previous;
    await app.close();
  });

  it("login is limited per IP and answers with RATE_LIMITED", async () => {
    const http = () => request(app.getHttpServer());
    const body = { email: "nobody@test.axis", password: "wrong-password" };
    for (let i = 0; i < 3; i++) await http().post("/v1/auth/login").send(body).expect(401);
    const limited = await http().post("/v1/auth/login").send(body).expect(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });

  it("buckets are per client IP forwarded by the trusted web server", async () => {
    const http = () => request(app.getHttpServer());
    const body = { email: "nobody@test.axis", password: "wrong-password" };
    const from = (ip: string) => http().post("/v1/auth/login").set("x-forwarded-for", ip).send(body);
    for (let i = 0; i < 3; i++) expect((await from("203.0.113.7")).status).toBe(401);
    expect((await from("203.0.113.7")).status).toBe(429);
    // A different user behind the same web server is unaffected
    expect((await from("198.51.100.20")).status).toBe(401);
  });
});
