import type { INestApplication } from "@nestjs/common";
import type { ContactDto, DealDto, PipelineDto } from "@axis/shared";
import request from "supertest";
import { addMember, createApp, ownerClient, signup, type Company } from "./helpers";

describe("CRM: contacts, deals, dashboard", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const contact = (who: { auth: Record<string, string> }, body: Record<string, unknown>) =>
    http().post("/v1/contacts").set(who.auth).send(body);
  const pipeline = async (who: Company) => (await http().get("/v1/pipelines").set(who.auth).expect(200)).body[0] as PipelineDto;
  const stage = (p: PipelineDto, kind: "open" | "won" | "lost", n = 0) => p.stages.filter((s) => s.kind === kind)[n]!;

  describe("contacts", () => {
    it("create, normalise input, search, filter, paginate", async () => {
      const owner = await signup(app);
      const created = await contact(owner, { name: "Orxan Səfərov", email: " ORXAN@Mail.AZ ", phone: "+994 (50) 123-45-67", companyName: "" }).expect(201);
      expect(created.body).toMatchObject({ email: "orxan@mail.az", phone: "+994501234567", companyName: null, stage: "LEAD", openDeals: 0 });
      expect(created.body.owner.name).toBe("Test Sahib");

      await contact(owner, { name: "Bakı Tekstil", type: "company", stage: "CUSTOMER" }).expect(201);
      for (let i = 0; i < 5; i++) await contact(owner, { name: `Lead ${i}` }).expect(201);

      const bySearch = await http().get("/v1/contacts").query({ q: "orxan" }).set(owner.auth).expect(200);
      expect(bySearch.body.items.map((c: ContactDto) => c.name)).toEqual(["Orxan Səfərov"]);
      const byPhone = await http().get("/v1/contacts").query({ q: "50 123" }).set(owner.auth).expect(200);
      expect(byPhone.body.total).toBe(1);
      const customers = await http().get("/v1/contacts").query({ stage: "CUSTOMER" }).set(owner.auth).expect(200);
      expect(customers.body.items.map((c: ContactDto) => c.name)).toEqual(["Bakı Tekstil"]);

      const page1 = await http().get("/v1/contacts").query({ limit: 3 }).set(owner.auth).expect(200);
      expect(page1.body).toMatchObject({ total: 7 });
      expect(page1.body.items).toHaveLength(3);
      const page2 = await http().get("/v1/contacts").query({ limit: 3, cursor: page1.body.nextCursor }).set(owner.auth).expect(200);
      const page3 = await http().get("/v1/contacts").query({ limit: 3, cursor: page2.body.nextCursor }).set(owner.auth).expect(200);
      expect(page3.body.nextCursor).toBeNull();
      const ids = [...page1.body.items, ...page2.body.items, ...page3.body.items].map((c: ContactDto) => c.id);
      expect(new Set(ids).size).toBe(7);
    });

    it("rejects invalid email/phone with field details", async () => {
      const owner = await signup(app);
      const res = await contact(owner, { name: "X", email: "not-an-email", phone: "12" }).expect(400);
      expect(Object.keys(res.body.error.details).sort()).toEqual(["email", "phone"]);
    });

    it("stage change and owner change land on the timeline with notes", async () => {
      const owner = await signup(app);
      const admin = await addMember(app, owner, "ADMIN");
      const me = await http().get("/v1/members").set(owner.auth);
      const adminMemberId = me.body.find((m: { email: string }) => m.email === admin.email).id;

      const c = (await contact(owner, { name: "Günay" }).expect(201)).body as ContactDto;
      await http().patch(`/v1/contacts/${c.id}`).set(owner.auth).send({ stage: "QUALIFIED", ownerId: adminMemberId }).expect(200);
      await http().post(`/v1/contacts/${c.id}/notes`).set(owner.auth).send({ body: "Zəng etdim, təklif istəyir" }).expect(201);
      await http().post(`/v1/contacts/${c.id}/notes`).set(owner.auth).send({ body: "   " }).expect(400);

      const timeline = await http().get(`/v1/contacts/${c.id}/activities`).set(owner.auth).expect(200);
      expect(timeline.body.map((a: { type: string }) => a.type)).toEqual(["note", "owner_changed", "contact_stage", "contact_created"]);
      expect(timeline.body[0]).toMatchObject({ payload: { body: "Zəng etdim, təklif istəyir" }, actor: { name: "Test Sahib" } });
      expect(timeline.body[1].payload.ownerName).toBe("Test ADMIN");
    });

    it("soft delete hides the contact; only admins may delete", async () => {
      const owner = await signup(app);
      const manager = await addMember(app, owner, "MANAGER");
      const c = (await contact(owner, { name: "Silinəcək", ownerId: null }).expect(201)).body as ContactDto;
      await http().delete(`/v1/contacts/${c.id}`).set(manager.auth).expect(403);
      await http().delete(`/v1/contacts/${c.id}`).set(owner.auth).expect(204);
      await http().get(`/v1/contacts/${c.id}`).set(owner.auth).expect(404);
      const list = await http().get("/v1/contacts").set(owner.auth).expect(200);
      expect(list.body.total).toBe(0);
      // Row still exists for restore/audit
      const db = await ownerClient();
      const { rows } = await db.query(`SELECT "deletedAt" FROM "Contact" WHERE id = $1`, [c.id]);
      await db.end();
      expect(rows[0].deletedAt).not.toBeNull();
    });
  });

  describe("visibility by role", () => {
    it("owner sees all; manager sees department + unassigned; employee sees only own", async () => {
      const owner = await signup(app);
      const manager = await addMember(app, owner, "MANAGER");
      const inDept = await addMember(app, owner, "EMPLOYEE");
      const outside = await addMember(app, owner, "EMPLOYEE");
      const dept = (await http().post("/v1/departments").set(owner.auth).send({ name: "Satış" }).expect(201)).body;
      for (const m of [manager, inDept]) {
        await http().patch(`/v1/members/${m.memberId}`).set(owner.auth).send({ departmentId: dept.id }).expect(200);
      }

      await contact(owner, { name: "Owner-only" }).expect(201);
      await contact(owner, { name: "Unassigned", ownerId: null }).expect(201);
      const mine = (await contact(inDept, { name: "Dept employee's" }).expect(201)).body as ContactDto;
      const theirs = (await contact(outside, { name: "Other employee's" }).expect(201)).body as ContactDto;

      const names = async (who: { auth: Record<string, string> }) =>
        ((await http().get("/v1/contacts").set(who.auth).expect(200)).body.items as ContactDto[]).map((c) => c.name).sort();

      expect(await names(owner)).toEqual(["Dept employee's", "Other employee's", "Owner-only", "Unassigned"]);
      expect(await names(manager)).toEqual(["Dept employee's", "Unassigned"]);
      expect(await names(inDept)).toEqual(["Dept employee's"]);
      expect(await names(outside)).toEqual(["Other employee's"]);

      // Direct access outside scope is 404 (no existence oracle), including writes
      await http().get(`/v1/contacts/${theirs.id}`).set(manager.auth).expect(404);
      await http().patch(`/v1/contacts/${theirs.id}`).set(inDept.auth).send({ name: "x" }).expect(404);
      await http().post(`/v1/contacts/${theirs.id}/notes`).set(inDept.auth).send({ body: "x" }).expect(404);
      await http().get(`/v1/contacts/${mine.id}`).set(manager.auth).expect(200);
    });

    it("employees cannot assign records to others; managers can", async () => {
      const owner = await signup(app);
      const employee = await addMember(app, owner, "EMPLOYEE");
      const manager = await addMember(app, owner, "MANAGER");
      await contact(employee, { name: "X", ownerId: manager.memberId }).expect(403);
      await contact(employee, { name: "X", ownerId: null }).expect(403);
      const own = (await contact(employee, { name: "Mine" }).expect(201)).body as ContactDto;
      expect(own.owner?.id).toBe(employee.memberId);
      await http().patch(`/v1/contacts/${own.id}`).set(employee.auth).send({ ownerId: manager.memberId }).expect(403);
      await http().patch(`/v1/contacts/${own.id}`).set(owner.auth).send({ ownerId: manager.memberId }).expect(200);
      // Unknown / foreign member ids are rejected
      await contact(owner, { name: "Y", ownerId: "mem_does_not_exist" }).expect(400);
    });

    it("another company's contacts and deals are unreachable", async () => {
      const a = await signup(app);
      const b = await signup(app);
      const c = (await contact(b, { name: "B müştəri" }).expect(201)).body as ContactDto;
      const d = (await http().post("/v1/deals").set(b.auth).send({ title: "B deal", contactId: c.id }).expect(201)).body as DealDto;
      await http().get(`/v1/contacts/${c.id}`).set(a.auth).expect(404);
      await http().get(`/v1/deals/${d.id}`).set(a.auth).expect(404);
      await http().post(`/v1/deals/${d.id}/move`).set(a.auth).send({ stageId: d.stageId }).expect(404);
      // Linking B's contact into A's deal is rejected
      await http().post("/v1/deals").set(a.auth).send({ title: "steal", contactId: c.id }).expect(400);
      // B's stage id can't be used in A's pipeline
      const aDeal = (await http().post("/v1/deals").set(a.auth).send({ title: "A deal" }).expect(201)).body as DealDto;
      await http().post(`/v1/deals/${aDeal.id}/move`).set(a.auth).send({ stageId: d.stageId }).expect(400);
      expect((await http().get("/v1/contacts").set(a.auth)).body.total).toBe(0);
    });
  });

  describe("deals pipeline", () => {
    it("signup seeds a default pipeline with ordered stages", async () => {
      const owner = await signup(app);
      const p = await pipeline(owner);
      expect(p.isDefault).toBe(true);
      expect(p.stages.map((s) => s.kind)).toEqual(["open", "open", "open", "open", "won", "lost"]);
    });

    it("new deals start in the first open stage and append to the column", async () => {
      const owner = await signup(app);
      const p = await pipeline(owner);
      const d1 = (await http().post("/v1/deals").set(owner.auth).send({ title: "Bir", amount: 150000 }).expect(201)).body as DealDto;
      const d2 = (await http().post("/v1/deals").set(owner.auth).send({ title: "İki" }).expect(201)).body as DealDto;
      expect(d1.stageId).toBe(stage(p, "open").id);
      expect(d2.position).toBeGreaterThan(d1.position);
      await http().post("/v1/deals").set(owner.auth).send({ title: "x", stageId: stage(p, "won").id }).expect(400);
      await http().post("/v1/deals").set(owner.auth).send({ title: "x", amount: -5 }).expect(400);
    });

    it("won closes the deal and turns the contact into a customer; reopening clears closedAt", async () => {
      const owner = await signup(app);
      const p = await pipeline(owner);
      const c = (await contact(owner, { name: "Fərid" }).expect(201)).body as ContactDto;
      const d = (await http().post("/v1/deals").set(owner.auth).send({ title: "Lisenziya", amount: 500000, contactId: c.id }).expect(201)).body;

      const won = await http().post(`/v1/deals/${d.id}/move`).set(owner.auth).send({ stageId: stage(p, "won").id }).expect(200);
      expect(won.body.closedAt).not.toBeNull();
      const card = await http().get(`/v1/contacts/${c.id}`).set(owner.auth).expect(200);
      expect(card.body.stage).toBe("CUSTOMER");
      expect(card.body.deals).toHaveLength(1);
      expect(card.body.openDeals).toBe(0);

      const reopened = await http().post(`/v1/deals/${d.id}/move`).set(owner.auth).send({ stageId: stage(p, "open", 2).id }).expect(200);
      expect(reopened.body).toMatchObject({ closedAt: null, lostReason: null });

      const detail = await http().get(`/v1/deals/${d.id}`).set(owner.auth).expect(200);
      expect(detail.body.activities.map((a: { type: string }) => a.type)).toEqual(["deal_stage", "deal_won", "deal_stage", "deal_created"]);
    });

    it("lost requires a reason, which is kept for reports", async () => {
      const owner = await signup(app);
      const p = await pipeline(owner);
      const d = (await http().post("/v1/deals").set(owner.auth).send({ title: "Bahalı", amount: 100000 }).expect(201)).body;
      const noReason = await http().post(`/v1/deals/${d.id}/move`).set(owner.auth).send({ stageId: stage(p, "lost").id }).expect(400);
      expect(noReason.body.error.details).toHaveProperty("lostReason");
      const lost = await http().post(`/v1/deals/${d.id}/move`).set(owner.auth).send({ stageId: stage(p, "lost").id, lostReason: "price" }).expect(200);
      expect(lost.body.lostReason).toBe("price");
    });

    it("forecast: open value, probability-weighted value, won and lost this month with reasons", async () => {
      const owner = await signup(app);
      const p = await pipeline(owner);
      const mk = async (title: string, amount: number, stageId?: string) =>
        (await http().post("/v1/deals").set(owner.auth).send({ title, amount, stageId }).expect(201)).body as DealDto;
      const s1 = stage(p, "open", 0); // 10 %
      const s3 = stage(p, "open", 2); // 50 %
      await mk("A", 100000, s1.id);
      await mk("B", 200000, s3.id);
      const w = await mk("W", 300000);
      const l1 = await mk("L1", 50000);
      const l2 = await mk("L2", 70000);
      await http().post(`/v1/deals/${w.id}/move`).set(owner.auth).send({ stageId: stage(p, "won").id }).expect(200);
      await http().post(`/v1/deals/${l1.id}/move`).set(owner.auth).send({ stageId: stage(p, "lost").id, lostReason: "price" }).expect(200);
      await http().post(`/v1/deals/${l2.id}/move`).set(owner.auth).send({ stageId: stage(p, "lost").id, lostReason: "price" }).expect(200);

      const f = await http().get("/v1/deals/forecast").set(owner.auth).expect(200);
      expect(f.body).toEqual({
        currency: "AZN",
        open: { count: 2, amount: 300000 },
        weighted: 100000 * (s1.probability / 100) + 200000 * (s3.probability / 100),
        wonThisMonth: { count: 1, amount: 300000 },
        lostThisMonth: { count: 2, amount: 120000, reasons: [{ reason: "price", count: 2 }] },
      });
    });

    it("only admins delete deals", async () => {
      const owner = await signup(app);
      const employee = await addMember(app, owner, "EMPLOYEE");
      const d = (await http().post("/v1/deals").set(employee.auth).send({ title: "Mine" }).expect(201)).body;
      await http().delete(`/v1/deals/${d.id}`).set(employee.auth).expect(403);
      await http().delete(`/v1/deals/${d.id}`).set(owner.auth).expect(204);
      await http().get(`/v1/deals/${d.id}`).set(owner.auth).expect(404);
    });
  });

  describe("dashboard", () => {
    it("KPIs, revenue series and team totals agree with each other", async () => {
      const owner = await signup(app);
      const seller = await addMember(app, owner, "EMPLOYEE");
      const p = await pipeline(owner);
      for (const n of ["a", "b", "c"]) await contact(owner, { name: n }).expect(201);
      const mk = async (who: { auth: Record<string, string> }, amount: number) =>
        (await http().post("/v1/deals").set(who.auth).send({ title: `D${amount}`, amount }).expect(201)).body as DealDto;
      const d1 = await mk(owner, 120000);
      const d2 = await mk(seller, 80000);
      await mk(seller, 999900); // stays open
      for (const d of [d1, d2]) await http().post(`/v1/deals/${d.id}/move`).set(owner.auth).send({ stageId: stage(p, "won").id }).expect(200);

      // A deal won 40 days ago counts in 90d but not in 30d, and as "previous" for 30d
      const old = await mk(owner, 50000);
      await http().post(`/v1/deals/${old.id}/move`).set(owner.auth).send({ stageId: stage(p, "won").id }).expect(200);
      const db = await ownerClient();
      await db.query(`UPDATE "Deal" SET "closedAt" = (now() AT TIME ZONE 'UTC') - interval '40 days' WHERE id = $1`, [old.id]);
      await db.end();

      const d30 = (await http().get("/v1/dashboard").query({ period: "30d" }).set(owner.auth).expect(200)).body;
      expect(d30.scope).toBe("all");
      expect(d30.kpis).toEqual({
        newContacts: { value: 3, previous: 0 },
        activeDeals: { value: 1, pipelineValue: 999900 },
        revenue: { value: 200000, previous: 50000 },
      });
      expect(d30.revenue.bucket).toBe("day");
      expect(d30.revenue.points).toHaveLength(30);
      const seriesTotal = d30.revenue.points.reduce((a: number, x: { amount: number }) => a + x.amount, 0);
      expect(seriesTotal).toBe(200000);
      // Today's bucket holds both wins
      expect(d30.revenue.points.at(-1)).toMatchObject({ amount: 200000, deals: 2 });
      const teamTotal = d30.team.reduce((a: number, x: { revenue: number }) => a + x.revenue, 0);
      expect(teamTotal).toBe(200000);
      expect(d30.team.find((x: { member: { name: string } }) => x.member.name === "Test EMPLOYEE")).toMatchObject({ dealsWon: 1, revenue: 80000 });
      expect(d30.activity.length).toBeGreaterThan(0);

      const d90 = (await http().get("/v1/dashboard").query({ period: "90d" }).set(owner.auth).expect(200)).body;
      expect(d90.revenue.bucket).toBe("week");
      expect(d90.kpis.revenue.value).toBe(250000);

      // The employee's dashboard only covers their own work
      const mine = (await http().get("/v1/dashboard").set(seller.auth).expect(200)).body;
      expect(mine.scope).toBe("own");
      expect(mine.kpis.revenue.value).toBe(80000);
      expect(mine.team).toHaveLength(1);

      await http().get("/v1/dashboard").query({ period: "1y" }).set(owner.auth).expect(400);
    });
  });
});
