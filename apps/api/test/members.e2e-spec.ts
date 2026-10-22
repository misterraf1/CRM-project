import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { addMember, createApp, ownerClient, PASSWORD, signup, uniqueEmail } from "./helpers";

describe("Members, invites, roles", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it("invite → preview → accept → login as the new member", async () => {
    const owner = await signup(app, "Dəvət MMC");
    const email = uniqueEmail("new");
    const inv = await http().post("/v1/members/invites").set(owner.auth).send({ email, role: "EMPLOYEE", fullName: "Yeni İşçi" }).expect(201);
    expect(inv.body.member.status).toBe("INVITED");
    expect(inv.body.invitePath).toMatch(/^\/invite\/tnt_[^.]+\.[\w-]{20,}$/);

    const token = inv.body.invitePath.replace("/invite/", "");
    const preview = await http().get(`/v1/invites/${token}`).expect(200);
    expect(preview.body).toMatchObject({ tenantName: "Dəvət MMC", email, role: "EMPLOYEE", needsAccount: true });

    await http().post(`/v1/invites/${token}/accept`).send({ password: "short" }).expect(400);
    await http().post(`/v1/invites/${token}/accept`).send({ password: PASSWORD, fullName: "Leyla Abbasova" }).expect(200);
    // Links are single-use
    const reused = await http().post(`/v1/invites/${token}/accept`).send({ password: PASSWORD });
    expect(reused.status).toBe(410);
    expect(reused.body.error.code).toBe("INVITE_INVALID");

    const login = await http().post("/v1/auth/login").send({ email, password: PASSWORD }).expect(200);
    const me = await http().get("/v1/me").set("authorization", `Bearer ${login.body.accessToken}`).expect(200);
    expect(me.body.user.fullName).toBe("Leyla Abbasova");
    expect(me.body.membership.role).toBe("EMPLOYEE");
    expect(me.body.permissions).not.toContain("members.invite");
  });

  it("tampered or foreign invite tokens are rejected", async () => {
    const a = await signup(app);
    const b = await signup(app);
    const inv = await http().post("/v1/members/invites").set(a.auth).send({ email: uniqueEmail("t") }).expect(201);
    const token: string = inv.body.invitePath.replace("/invite/", "");
    const [, secret] = token.split(".");
    const meB = await http().get("/v1/me").set(b.auth);
    // Right secret, wrong tenant prefix
    await http().get(`/v1/invites/${meB.body.tenant.id}.${secret}`).expect(410);
    await http().get(`/v1/invites/${token}x`).expect(410);
    await http().get(`/v1/invites/garbage`).expect(410);
  });

  it("expired invites are rejected", async () => {
    const owner = await signup(app);
    const email = uniqueEmail("late");
    const inv = await http().post("/v1/members/invites").set(owner.auth).send({ email }).expect(201);
    const db = await ownerClient();
    await db.query(`UPDATE "Membership" SET "invitedAt" = (now() AT TIME ZONE 'UTC') - interval '8 days' WHERE id = $1`, [inv.body.member.id]);
    await db.end();
    await http().get(inv.body.invitePath.replace("/invite/", "/v1/invites/")).expect(410);
  });

  it("permissions: employee and manager cannot invite or manage; admin cannot create owners", async () => {
    const owner = await signup(app);
    const employee = await addMember(app, owner, "EMPLOYEE");
    const manager = await addMember(app, owner, "MANAGER");
    const admin = await addMember(app, owner, "ADMIN");

    const denied = await http().post("/v1/members/invites").set(employee.auth).send({ email: uniqueEmail("x") });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
    await http().post("/v1/members/invites").set(manager.auth).send({ email: uniqueEmail("x") }).expect(403);
    await http().patch(`/v1/members/${employee.memberId}`).set(manager.auth).send({ role: "MANAGER" }).expect(403);
    await http().post("/v1/departments").set(manager.auth).send({ name: "Gizli" }).expect(403);
    await http().get("/v1/audit-logs").set(employee.auth).expect(403);
    // Everyone can see the team list
    await http().get("/v1/members").set(employee.auth).expect(200);

    await http().post("/v1/members/invites").set(admin.auth).send({ email: uniqueEmail("x"), role: "OWNER" }).expect(403);
    await http().patch(`/v1/members/${employee.memberId}`).set(admin.auth).send({ role: "OWNER" }).expect(403);
    await http().patch(`/v1/members/${employee.memberId}`).set(admin.auth).send({ role: "MANAGER" }).expect(200);
  });

  it("role change takes effect on the next request, without re-login", async () => {
    const owner = await signup(app);
    const member = await addMember(app, owner, "EMPLOYEE");
    await http().post("/v1/departments").set(member.auth).send({ name: "Yeni" }).expect(403);
    await http().patch(`/v1/members/${member.memberId}`).set(owner.auth).send({ role: "ADMIN" }).expect(200);
    await http().post("/v1/departments").set(member.auth).send({ name: "Yeni" }).expect(201);
  });

  it("disabling a member kills their sessions immediately; re-enabling restores access via login", async () => {
    const owner = await signup(app);
    const member = await addMember(app, owner, "EMPLOYEE");
    await http().get("/v1/me").set(member.auth).expect(200);
    await http().patch(`/v1/members/${member.memberId}`).set(owner.auth).send({ status: "DISABLED" }).expect(200);
    await http().get("/v1/me").set(member.auth).expect(401);
    await http().post("/v1/auth/login").send({ email: member.email, password: PASSWORD }).expect(403);

    await http().patch(`/v1/members/${member.memberId}`).set(owner.auth).send({ status: "ACTIVE" }).expect(200);
    await http().post("/v1/auth/login").send({ email: member.email, password: PASSWORD }).expect(200);
  });

  it("owner protections: no self-demotion, at least one owner stays", async () => {
    const owner = await signup(app);
    const me = await http().get("/v1/me").set(owner.auth);
    const ownMemberId = me.body.membership.id;
    await http().patch(`/v1/members/${ownMemberId}`).set(owner.auth).send({ role: "ADMIN" }).expect(403);

    const second = await addMember(app, owner, "OWNER");
    // Second owner demotes the first: allowed because one owner remains
    await http().patch(`/v1/members/${ownMemberId}`).set(second.auth).send({ role: "ADMIN" }).expect(200);
    // Now `second` is the last owner; the demoted admin cannot touch them
    await http().patch(`/v1/members/${second.memberId}`).set(owner.auth).send({ role: "ADMIN" }).expect(403);
  });

  it("two owners demoting each other concurrently cannot leave the company ownerless", async () => {
    const first = await signup(app);
    const second = await addMember(app, first, "OWNER");
    const me = await http().get("/v1/me").set(first.auth);
    const [x, y] = await Promise.all([
      http().patch(`/v1/members/${second.memberId}`).set(first.auth).send({ role: "ADMIN" }),
      http().patch(`/v1/members/${me.body.membership.id}`).set(second.auth).send({ role: "ADMIN" }),
    ]);
    // The loser is stopped either by the row lock (LAST_OWNER) or, if the winner already
    // committed before its request was authorised, because it is no longer an owner.
    const loser = [x, y].find((r) => r.status !== 200)!;
    expect([x, y].filter((r) => r.status === 200)).toHaveLength(1);
    expect(["LAST_OWNER", "FORBIDDEN"]).toContain(loser.body.error.code);

    const db = await ownerClient();
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM "Membership" WHERE "tenantId" = $1 AND role = 'OWNER' AND status = 'ACTIVE'`,
      [me.body.tenant.id],
    );
    await db.end();
    expect(rows[0].n).toBe(1);
  });

  it("seat limit: pending invites count; START plan allows 3 seats", async () => {
    const owner = await signup(app);
    const me = await http().get("/v1/me").set(owner.auth);
    const db = await ownerClient();
    await db.query(`UPDATE "Subscription" SET "planId" = (SELECT id FROM "Plan" WHERE code = 'START') WHERE "tenantId" = $1`, [
      me.body.tenant.id,
    ]);
    await db.end();

    await http().post("/v1/members/invites").set(owner.auth).send({ email: uniqueEmail("s1") }).expect(201);
    const pending = await http().post("/v1/members/invites").set(owner.auth).send({ email: uniqueEmail("s2") }).expect(201);
    const over = await http().post("/v1/members/invites").set(owner.auth).send({ email: uniqueEmail("s3") });
    expect(over.status).toBe(402);
    expect(over.body.error).toMatchObject({ code: "SEAT_LIMIT", details: { used: 3, limit: 3 } });

    // Revoking a pending invite frees the seat
    await http().patch(`/v1/members/${pending.body.member.id}`).set(owner.auth).send({ status: "DISABLED" }).expect(200);
    await http().post("/v1/members/invites").set(owner.auth).send({ email: uniqueEmail("s4") }).expect(201);
  });

  it("re-inviting a pending member issues a new link and invalidates the old one", async () => {
    const owner = await signup(app);
    const email = uniqueEmail("again");
    const first = await http().post("/v1/members/invites").set(owner.auth).send({ email }).expect(201);
    const second = await http().post("/v1/members/invites").set(owner.auth).send({ email, role: "MANAGER" }).expect(201);
    expect(second.body.member.id).toBe(first.body.member.id);
    await http().get(first.body.invitePath.replace("/invite/", "/v1/invites/")).expect(410);
    const preview = await http().get(second.body.invitePath.replace("/invite/", "/v1/invites/")).expect(200);
    expect(preview.body.role).toBe("MANAGER");
    // Inviting an active member is a conflict
    const member = await addMember(app, owner, "EMPLOYEE");
    await http().post("/v1/members/invites").set(owner.auth).send({ email: member.email }).expect(409);
  });

  it("audit log records invites, joins and role changes with diffs", async () => {
    const owner = await signup(app);
    const member = await addMember(app, owner, "EMPLOYEE");
    await http().patch(`/v1/members/${member.memberId}`).set(owner.auth).send({ role: "MANAGER", title: "Rəhbər" }).expect(200);
    const logs = await http().get("/v1/audit-logs").set(owner.auth).expect(200);
    const actions = logs.body.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["tenant.created", "member.invited", "member.joined", "member.updated"]));
    const update = logs.body.find((l: { action: string }) => l.action === "member.updated");
    expect(update.diff).toEqual({ role: { from: "EMPLOYEE", to: "MANAGER" }, title: { from: null, to: "Rəhbər" } });
    expect(update.actor.fullName).toBe("Test Sahib");
  });

  it("departments: unique names, member assignment, delete detaches members", async () => {
    const owner = await signup(app);
    const member = await addMember(app, owner, "EMPLOYEE");
    const dept = await http().post("/v1/departments").set(owner.auth).send({ name: "Satış" }).expect(201);
    await http().post("/v1/departments").set(owner.auth).send({ name: "Satış" }).expect(409);
    await http().patch(`/v1/members/${member.memberId}`).set(owner.auth).send({ departmentId: dept.body.id }).expect(200);
    const list = await http().get("/v1/departments").set(owner.auth).expect(200);
    expect(list.body[0]).toMatchObject({ name: "Satış", memberCount: 1 });
    await http().delete(`/v1/departments/${dept.body.id}`).set(owner.auth).expect(204);
    const members = await http().get("/v1/members").set(owner.auth).expect(200);
    expect(members.body.find((m: { id: string }) => m.id === member.memberId).departmentId).toBeNull();
  });
});
