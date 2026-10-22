import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { addMember, appRoleClient, createApp, signup } from "./helpers";

// The core SaaS guarantee: one company can never see or touch another's data.

describe("Tenant isolation", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it("API: members, departments and audit logs are scoped to the caller's company", async () => {
    const a = await signup(app, "Şirkət A");
    const b = await signup(app, "Şirkət B");
    const bMember = await addMember(app, b, "EMPLOYEE");
    const bDept = await http().post("/v1/departments").set(b.auth).send({ name: "B Satış" }).expect(201);

    const aMembers = await http().get("/v1/members").set(a.auth).expect(200);
    expect(aMembers.body).toHaveLength(1);
    const aDepts = await http().get("/v1/departments").set(a.auth).expect(200);
    expect(aDepts.body).toEqual([]);
    const aAudit = await http().get("/v1/audit-logs").set(a.auth).expect(200);
    expect(aAudit.body.every((l: { action: string }) => !l.action.startsWith("department"))).toBe(true);

    // Direct attacks with B's ids from A's session → 404, never 200/403 (no existence oracle)
    await http().patch(`/v1/members/${bMember.memberId}`).set(a.auth).send({ role: "ADMIN" }).expect(404);
    await http().patch(`/v1/departments/${bDept.body.id}`).set(a.auth).send({ name: "hacked" }).expect(404);
    await http().delete(`/v1/departments/${bDept.body.id}`).set(a.auth).expect(404);
    // Referencing B's department from A is rejected as unknown
    await http().post("/v1/members/invites").set(a.auth).send({ email: "x@test.axis", departmentId: bDept.body.id }).expect(400);

    const bDepts = await http().get("/v1/departments").set(b.auth).expect(200);
    expect(bDepts.body[0].name).toBe("B Satış");
  });

  it("a user in two companies sees only the active company's members", async () => {
    const a = await signup(app, "Holding A");
    const b = await signup(app, "Holding B");
    const shared = await addMember(app, a, "MANAGER");
    // Same person invited into B; accepts with their existing password
    const invite = await http().post("/v1/members/invites").set(b.auth).send({ email: shared.email, role: "EMPLOYEE" }).expect(201);
    const token = invite.body.invitePath.replace("/invite/", "");
    const preview = await http().get(`/v1/invites/${token}`).expect(200);
    expect(preview.body.needsAccount).toBe(false);
    await http().post(`/v1/invites/${token}/accept`).send({ password: "wrong-password" }).expect(401);
    const joined = await http().post(`/v1/invites/${token}/accept`).send({ password: "Sup3r-secret!" }).expect(200);
    const inB = { authorization: `Bearer ${joined.body.accessToken}` };

    const me = await http().get("/v1/me").set(inB).expect(200);
    expect(me.body.memberships).toHaveLength(2);
    const members = await http().get("/v1/members").set(inB).expect(200);
    expect(members.body.map((m: { role: string }) => m.role).sort()).toEqual(["EMPLOYEE", "OWNER"]);

    // Switch to A: role there is MANAGER and the B session is ended
    const aTenant = me.body.memberships.find((m: { tenantName: string }) => m.tenantName === "Holding A").tenantId;
    const switched = await http().post("/v1/auth/switch").set(inB).send({ tenantId: aTenant }).expect(200);
    const meA = await http().get("/v1/me").set("authorization", `Bearer ${switched.body.accessToken}`).expect(200);
    expect(meA.body.membership.role).toBe("MANAGER");
    await http().get("/v1/me").set(inB).expect(401);
  });

  it("switching to a company the user doesn't belong to fails", async () => {
    const a = await signup(app, "Tək A");
    const b = await signup(app, "Tək B");
    const meB = await http().get("/v1/me").set(b.auth).expect(200);
    await http().post("/v1/auth/switch").set(a.auth).send({ tenantId: meB.body.tenant.id }).expect(404);
  });

  describe("PostgreSQL RLS (below the API)", () => {
    it("every table with tenantId has RLS enabled and forced (except Session)", async () => {
      const db = await appRoleClient();
      const { rows } = await db.query(`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c JOIN information_schema.columns col ON col.table_name = c.relname AND col.table_schema = 'public'
        WHERE col.column_name = 'tenantId' AND c.relkind = 'r'`);
      await db.end();
      const unprotected = rows.filter((r: { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }) => r.relname !== "Session" && !(r.relrowsecurity && r.relforcerowsecurity));
      expect(rows.length).toBeGreaterThan(20);
      expect(unprotected).toEqual([]);
    });

    it("without context the app role sees no tenant rows at all", async () => {
      await signup(app, "Görünməz");
      const db = await appRoleClient();
      const counts = await db.query(`SELECT
        (SELECT count(*) FROM "Tenant")::int AS tenants,
        (SELECT count(*) FROM "Membership")::int AS memberships,
        (SELECT count(*) FROM "Subscription")::int AS subscriptions,
        (SELECT count(*) FROM "AuditLog")::int AS audit`);
      await db.end();
      expect(counts.rows[0]).toEqual({ tenants: 0, memberships: 0, subscriptions: 0, audit: 0 });
    });

    it("with tenant A's context, B's rows are invisible and cannot be written", async () => {
      const a = await signup(app, "RLS A");
      const b = await signup(app, "RLS B");
      const [meA, meB] = await Promise.all([http().get("/v1/me").set(a.auth), http().get("/v1/me").set(b.auth)]);
      const A = meA.body.tenant.id as string;
      const B = meB.body.tenant.id as string;

      const db = await appRoleClient();
      await db.query("BEGIN");
      await db.query("SELECT set_config('app.tenant_id', $1, true)", [A]);
      // A query that "forgot" its tenant filter still only returns A
      const tenants = await db.query(`SELECT id FROM "Tenant"`);
      expect(tenants.rows.map((r: { id: string }) => r.id)).toEqual([A]);
      const leaked = await db.query(`SELECT count(*)::int AS n FROM "Membership" WHERE "tenantId" = $1`, [B]);
      expect(leaked.rows[0].n).toBe(0);
      // Updates against B affect nothing
      const upd = await db.query(`UPDATE "Tenant" SET name = 'pwned' WHERE id = $1`, [B]);
      expect(upd.rowCount).toBe(0);
      // Inserting a row for B is rejected by the policy
      await expect(db.query(`INSERT INTO "Department" (id, "tenantId", name) VALUES ('x', $1, 'evil')`, [B])).rejects.toThrow(
        /row-level security/,
      );
      await db.query("ROLLBACK");

      // Platform finance table is off-limits; plans are read-only
      await expect(db.query(`SELECT * FROM "PlatformExpense"`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`UPDATE "Plan" SET "priceMonthly" = 0`)).rejects.toThrow(/permission denied/);
      await db.end();

      const stillB = await http().get("/v1/me").set(b.auth).expect(200);
      expect(stillB.body.tenant.name).toBe("RLS B");
    });
  });
});
