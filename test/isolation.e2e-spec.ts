import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { TENANT_MODELS, TenantGuardError } from "../src/prisma/tenant-guard";
import { addMember, createApp, signup } from "./helpers";

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

  describe("tenant guard (below the API)", () => {
    // The same guard every API query passes through, exercised directly with
    // deliberately unfiltered queries — what a bug in a service would look like.
    const guarded = () => app.get(PrismaService);

    it("every model with tenantId is guarded (except Session)", () => {
      const withTenant = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === "tenantId")).map((m) => m.name);
      expect(withTenant.length).toBeGreaterThan(20);
      expect(withTenant.filter((m) => m !== "Session" && !TENANT_MODELS.has(m))).toEqual([]);
    });

    it("without tenant context nothing is visible and nothing can be written", async () => {
      await signup(app, "Görünməz");
      const db = guarded();
      expect(await db.tenant.count()).toBe(0);
      expect(await db.membership.count()).toBe(0);
      expect(await db.subscription.count()).toBe(0);
      expect(await db.auditLog.count()).toBe(0);
      await expect(db.department.create({ data: { tenantId: "anything", name: "x" } })).rejects.toThrow(TenantGuardError);
    });

    it("with tenant A's context, B's data is invisible and can't be changed or created", async () => {
      const a = await signup(app, "Guard A");
      const b = await signup(app, "Guard B");
      const [meA, meB] = await Promise.all([http().get("/v1/me").set(a.auth), http().get("/v1/me").set(b.auth)]);
      const A = meA.body.tenant.id as string;
      const B = meB.body.tenant.id as string;
      const bMembership = meB.body.membership.id as string;

      await guarded().scoped(
        async (tx) => {
          // Queries that "forgot" their tenant filter still only see A
          expect((await tx.tenant.findMany({ select: { id: true } })).map((t) => t.id)).toEqual([A]);
          expect(await tx.membership.count({ where: { tenantId: B } })).toBe(0);
          expect(await tx.membership.findUnique({ where: { id: bMembership } })).toBeNull();
          // Writes against B affect nothing
          expect((await tx.tenant.updateMany({ where: { id: B }, data: { name: "pwned" } })).count).toBe(0);
          expect((await tx.membership.updateMany({ where: { id: bMembership }, data: { role: "EMPLOYEE" } })).count).toBe(0);
          await expect(tx.membership.update({ where: { id: bMembership }, data: { role: "EMPLOYEE" } })).rejects.toThrow();
          // Creating rows for B, or moving a row to B, is rejected
          await expect(tx.department.create({ data: { tenantId: B, name: "evil" } })).rejects.toThrow(TenantGuardError);
          await expect(tx.contact.createMany({ data: [{ tenantId: A, name: "ok" }, { tenantId: B, name: "evil" }] })).rejects.toThrow(TenantGuardError);
          const own = await tx.contact.create({ data: { tenantId: A, name: "Mine" } });
          await expect(tx.contact.update({ where: { id: own.id }, data: { tenantId: B } })).rejects.toThrow(TenantGuardError);
          throw new Error("rollback");
        },
        { tenantId: A },
      ).catch((e) => {
        if (e.message !== "rollback") throw e;
      });

      // Platform tables: finance is off-limits, plans are read-only
      await expect(guarded().platformExpense.findMany()).rejects.toThrow(TenantGuardError);
      await expect(guarded().plan.updateMany({ data: { priceMonthly: 0 } })).rejects.toThrow(TenantGuardError);
      expect(await guarded().plan.count()).toBe(3);

      const stillB = await http().get("/v1/me").set(b.auth).expect(200);
      expect(stillB.body.tenant.name).toBe("Guard B");
      expect(stillB.body.membership.role).toBe("OWNER");
    });

    it("system() is the only way across tenants", async () => {
      await signup(app, "Sistem");
      expect(await guarded().tenant.count()).toBe(0);
      expect(await guarded().system(() => guarded().tenant.count())).toBeGreaterThan(0);
    });
  });
});
