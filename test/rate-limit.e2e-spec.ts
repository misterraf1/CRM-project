import request from "supertest";
import type { TestApp } from "./helpers";

describe("Rate limiting", () => {
  let app: TestApp;
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

  it("signed-in requests are limited per user, so colleagues behind one office IP don't share a bucket", async () => {
    const { signup } = await import("./helpers");
    const http = () => request(app.getHttpServer());
    const a = await signup(app);
    const b = await signup(app);
    const officeIp = "198.51.100.77";
    // 600/min per user: both users together exceed what a shared 600/min IP bucket would allow
    const burst = async (auth: Record<string, string>, n: number) => {
      let limited = 0;
      for (let i = 0; i < n; i++) if ((await http().get("/v1/me/summary").set(auth).set("x-forwarded-for", officeIp)).status === 429) limited++;
      return limited;
    };
    expect(await burst(a.auth, 400)).toBe(0);
    expect(await burst(b.auth, 400)).toBe(0);
    // A forged token falls back to the IP bucket instead of creating a fresh one
    const forged = { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged" };
    const statuses = new Set<number>();
    for (let i = 0; i < 3; i++) statuses.add((await http().get("/v1/me").set(forged).set("x-forwarded-for", officeIp)).status);
    expect([...statuses]).toEqual([401]);
  }, 120_000);

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
