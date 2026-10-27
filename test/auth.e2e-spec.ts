import request from "supertest";
import { createHash } from "node:crypto";
import { createApp, PASSWORD, signup, uniqueEmail, withRawDb, type TestApp } from "./helpers";

describe("Auth", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it("health check", () => http().get("/health").expect(200, { status: "ok" }));

  it("signup creates company, owner and a full-feature trial (BUSINESS)", async () => {
    const company = await signup(app, "Bakı Tekstil MMC");
    const me = await http().get("/v1/me").set(company.auth).expect(200);
    expect(me.body.membership.role).toBe("OWNER");
    expect(me.body.tenant.name).toBe("Bakı Tekstil MMC");
    expect(me.body.tenant.slug).toMatch(/^baki-tekstil-mmc/);
    expect(me.body.subscription).toMatchObject({ plan: "BUSINESS", status: "TRIALING", seats: { used: 1, limit: 25 }, cancelAtPeriodEnd: false, graceEndsAt: null });
    expect(me.body.subscription.features).toEqual(expect.arrayContaining(["deals.pipeline", "inbox.omnichannel", "departments", "automations"]));
    expect(me.body.permissions).toContain("billing.manage");
  });

  it("two companies with the same name get distinct slugs", async () => {
    const a = await signup(app, "Eyni Ad");
    const b = await signup(app, "Eyni Ad");
    const [ma, mb] = await Promise.all([http().get("/v1/me").set(a.auth), http().get("/v1/me").set(b.auth)]);
    expect(ma.body.tenant.slug).not.toBe(mb.body.tenant.slug);
  });

  it("rejects duplicate email and invalid input", async () => {
    const { email } = await signup(app);
    const dup = await http().post("/v1/auth/signup").send({ companyName: "X MMC", fullName: "X Y", email, password: PASSWORD });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("EMAIL_TAKEN");

    const bad = await http().post("/v1/auth/signup").send({ companyName: "X", fullName: "", email: "nope", password: "short" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(bad.body.error.details)).toEqual(expect.arrayContaining(["companyName", "email", "password"]));
  });

  it("login: wrong password and unknown email look identical", async () => {
    const { email } = await signup(app);
    const wrong = await http().post("/v1/auth/login").send({ email, password: "wrong-password" });
    const unknown = await http().post("/v1/auth/login").send({ email: uniqueEmail("ghost"), password: "wrong-password" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);

    const ok = await http().post("/v1/auth/login").send({ email: email.toUpperCase(), password: PASSWORD }).expect(200);
    expect(ok.body.accessToken).toEqual(expect.any(String));
  });

  it("rejects missing, malformed and forged tokens", async () => {
    await http().get("/v1/me").expect(401);
    await http().get("/v1/me").set("authorization", "Bearer not-a-jwt").expect(401);
    const { tokens } = await signup(app);
    const [h, p] = tokens.accessToken.split(".");
    await http().get("/v1/me").set("authorization", `Bearer ${h}.${p}.forgedsignature`).expect(401);
  });

  it("refresh rotates tokens; reusing an old token revokes the whole family", async () => {
    const { tokens } = await signup(app);
    const r1 = await http().post("/v1/auth/refresh").send({ refreshToken: tokens.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(tokens.refreshToken);
    await http().get("/v1/me").set("authorization", `Bearer ${r1.body.accessToken}`).expect(200);

    const r2 = await http().post("/v1/auth/refresh").send({ refreshToken: r1.body.refreshToken }).expect(200);

    // Simulate theft: the original token is replayed later. Concurrent refreshes within
    // 30 s are tolerated, so age this family's rotation timestamps past that window.
    const hash = createHash("sha256").update(tokens.refreshToken).digest("hex");
    await withRawDb(async (db) => {
      const { familyId } = await db.session.get({ tokenHash: hash });
      await db.session.updateMany({ familyId, rotatedAt: { $ne: null } }, { $set: { rotatedAt: new Date(Date.now() - 3600_000) } });
    });

    await http().post("/v1/auth/refresh").send({ refreshToken: tokens.refreshToken }).expect(401);
    // The legitimate latest token is now dead too, and so is its access token
    await http().post("/v1/auth/refresh").send({ refreshToken: r2.body.refreshToken }).expect(401);
    await http().get("/v1/me").set("authorization", `Bearer ${r2.body.accessToken}`).expect(401);
  });

  it("parallel refreshes of the same token within the grace window both succeed", async () => {
    const { tokens } = await signup(app);
    const [a, b] = await Promise.all([
      http().post("/v1/auth/refresh").send({ refreshToken: tokens.refreshToken }),
      http().post("/v1/auth/refresh").send({ refreshToken: tokens.refreshToken }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it("logout revokes refresh and access tokens immediately", async () => {
    const { tokens, auth } = await signup(app);
    await http().post("/v1/auth/logout").send({ refreshToken: tokens.refreshToken }).expect(204);
    await http().get("/v1/me").set(auth).expect(401);
    await http().post("/v1/auth/refresh").send({ refreshToken: tokens.refreshToken }).expect(401);
  });
});
