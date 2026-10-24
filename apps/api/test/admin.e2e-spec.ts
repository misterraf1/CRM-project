import type { INestApplication } from "@nestjs/common";
import type { AdminOverviewDto, AdminTenantDetail, AdminTenantListResponse, CheckoutResponse, SystemHealthDto, TicketDto } from "@axis/shared";
import request from "supertest";
import { addMember, createApp, platformStaff, signup, withRawDb, type Company } from "./helpers";

const DAY = 86_400_000;

describe("Super Admin (platform)", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  let admin: Awaited<ReturnType<typeof platformStaff>>;
  let support: Awaited<ReturnType<typeof platformStaff>>;

  beforeAll(async () => {
    app = await createApp();
    admin = await platformStaff(app, "SUPER_ADMIN");
    support = await platformStaff(app, "SUPPORT");
  });
  afterAll(() => app.close());

  const overview = async () => (await http().get("/v1/admin/overview").set(admin.auth).expect(200)).body as AdminOverviewDto;
  const tenantOf = async (who: Company) => (await http().get("/v1/me").set(who.auth)).body.tenant.id as string;
  const detail = async (id: string) => (await http().get(`/v1/admin/tenants/${id}`).set(admin.auth).expect(200)).body as AdminTenantDetail;

  async function paidCompany(name: string, plan = "PRO") {
    const owner = await signup(app, name);
    const co = (await http().post("/v1/billing/checkout").set(owner.auth).send({ planCode: plan, interval: "MONTH" }).expect(201)).body as CheckoutResponse;
    await http().post(`/v1/billing/demo/invoices/${co.invoice.id}/complete`).set(owner.auth).send({ outcome: "success" }).expect(200);
    return owner;
  }

  it("admin and tenant sign-ins are separate: tokens don't cross, non-staff can't log in, logout and role removal apply at once", async () => {
    const owner = await signup(app);
    // A company owner is not platform staff — same answer as a wrong password
    const denied = await http().post("/v1/admin/auth/login").send({ email: owner.email, password: "Sınaq-parol-123" }).expect(401);
    expect(denied.body.error.code).toBe("INVALID_CREDENTIALS");
    await http().post("/v1/admin/auth/login").send({ email: admin.email, password: "wrong-password" }).expect(401);

    await http().get("/v1/admin/overview").expect(401);
    await http().get("/v1/admin/overview").set(owner.auth).expect(401);
    await http().get("/v1/me").set(admin.auth).expect(401);
    expect((await http().get("/v1/admin/auth/me").set(admin.auth).expect(200)).body).toMatchObject({ email: admin.email, role: "SUPER_ADMIN" });

    const temp = await platformStaff(app, "SUPPORT");
    await http().get("/v1/admin/overview").set(temp.auth).expect(200);
    await withRawDb((db) => db.user.update({ where: { id: temp.userId }, data: { platformRole: "NONE" } }));
    await http().get("/v1/admin/overview").set(temp.auth).expect(401);

    const again = await platformStaff(app, "SUPPORT");
    await http().post("/v1/admin/auth/logout").set(again.auth).expect(204);
    await http().get("/v1/admin/overview").set(again.auth).expect(401);
  });

  it("overview: MRR, statuses, revenue, expenses and profit move with real payments and costs", async () => {
    const before = await overview();
    await paidCompany("Overview MMC");
    const exp = await http().post("/v1/admin/expenses").set(admin.auth).send({ category: "server", vendor: "Test Cloud", amount: 1500, incurredOn: new Date().toISOString().slice(0, 10) }).expect(201);
    const after = await overview();
    expect(after.mrr - before.mrr).toBe(9900);
    expect(after.arr).toBe(after.mrr * 12);
    expect(after.tenants.ACTIVE - before.tenants.ACTIVE).toBe(1);
    expect(after.tenants.total - before.tenants.total).toBe(1);
    expect(after.signups30d - before.signups30d).toBe(1);
    expect(after.revenue30d - before.revenue30d).toBe(9900);
    expect(after.expenses30d - before.expenses30d).toBe(1500);
    expect(after.profit30d).toBe(after.revenue30d - after.expenses30d);
    expect(after.months).toHaveLength(6);
    expect(after.months.at(-1)!.revenue - before.months.at(-1)!.revenue).toBe(9900);

    await http().delete(`/v1/admin/expenses/${exp.body.id}`).set(admin.auth).expect(204);
    expect((await overview()).expenses30d).toBe(before.expenses30d);
  });

  it("companies: search, status filter and detail with members, usage and invoices", async () => {
    const owner = await paidCompany("Axtarış Unikal QSC");
    await addMember(app, owner, "EMPLOYEE");
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Admin Görür" }).expect(201);
    const id = await tenantOf(owner);

    const found = (await http().get("/v1/admin/tenants").query({ q: "unikal qsc" }).set(admin.auth).expect(200)).body as AdminTenantListResponse;
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({ id, plan: "PRO", status: "ACTIVE", mrr: 9900, ownerEmail: owner.email, seats: { used: 2, limit: 10 } });
    const active = (await http().get("/v1/admin/tenants").query({ q: "unikal qsc", status: "TRIALING" }).set(admin.auth).expect(200)).body as AdminTenantListResponse;
    expect(active.items).toHaveLength(0);

    const d = await detail(id);
    expect(d.members.map((m) => m.role).sort()).toEqual(["EMPLOYEE", "OWNER"]);
    expect(d.usage.contacts).toBe(1);
    expect(d.invoices[0]).toMatchObject({ status: "PAID", amount: 9900 });
    expect(d.subscription.paymentMethod).toEqual({ brand: "Visa", last4: "4242" });
    await http().get("/v1/admin/tenants/nope").set(admin.auth).expect(404);
  });

  it("support actions: extend trial, suspend makes the company read-only, unsuspend restores it — all audited", async () => {
    const trial = await signup(app, "Trial Uzat");
    const trialId = await tenantOf(trial);
    const end0 = new Date((await detail(trialId)).subscription.trialEndsAt!).getTime();
    await http().post(`/v1/admin/tenants/${trialId}/extend-trial`).set(admin.auth).send({ days: 5 }).expect(204);
    expect(new Date((await detail(trialId)).subscription.trialEndsAt!).getTime() - end0).toBe(5 * DAY);
    await http().post(`/v1/admin/tenants/${trialId}/extend-trial`).set(admin.auth).send({ days: 99 }).expect(400);

    const paid = await paidCompany("Dayandır MMC");
    const paidId = await tenantOf(paid);
    await http().post(`/v1/admin/tenants/${paidId}/extend-trial`).set(admin.auth).send({ days: 5 }).expect(409);
    await http().post(`/v1/admin/tenants/${paidId}/suspend`).set(admin.auth).send({ reason: "Chargeback yoxlaması" }).expect(204);
    const blocked = await http().post("/v1/contacts").set(paid.auth).send({ name: "x" }).expect(402);
    expect(blocked.body.error.code).toBe("SUBSCRIPTION_INACTIVE");
    await http().get("/v1/contacts").set(paid.auth).expect(200);
    await http().post(`/v1/admin/tenants/${paidId}/suspend`).set(admin.auth).send({ reason: "again" }).expect(409);

    await http().post(`/v1/admin/tenants/${paidId}/unsuspend`).set(admin.auth).expect(204);
    await http().post("/v1/contacts").set(paid.auth).send({ name: "Yenidən işləyir" }).expect(201);
    // An unpaid trial can't be "unsuspended" for free
    await http().post(`/v1/admin/tenants/${trialId}/unsuspend`).set(admin.auth).expect(409);

    const actions = (await detail(paidId)).activity.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["platform.suspended", "platform.unsuspended"]));
    // The company sees platform actions in its own audit log
    const audit = (await http().get("/v1/audit-logs").set(paid.auth).expect(200)).body;
    expect(JSON.stringify(audit)).toContain("platform.suspended");
  });

  it("SUPPORT reads and answers but cannot change prices, costs or accounts", async () => {
    const owner = await signup(app);
    const id = await tenantOf(owner);
    await http().get("/v1/admin/overview").set(support.auth).expect(200);
    await http().get(`/v1/admin/tenants/${id}`).set(support.auth).expect(200);
    await http().get("/v1/admin/plans").set(support.auth).expect(200);
    await http().get("/v1/admin/system").set(support.auth).expect(200);
    await http().post(`/v1/admin/tenants/${id}/suspend`).set(support.auth).send({ reason: "nope" }).expect(403);
    await http().post(`/v1/admin/tenants/${id}/extend-trial`).set(support.auth).send({ days: 3 }).expect(403);
    await http().patch("/v1/admin/plans/PRO").set(support.auth).send({ priceMonthly: 1 }).expect(403);
    await http().get("/v1/admin/expenses").set(support.auth).expect(403);
  });

  it("plan editor: new price applies to the next checkout; invalid features are rejected", async () => {
    const plans = (await http().get("/v1/admin/plans").set(admin.auth).expect(200)).body as { code: string; priceMonthly: number; features: string[] }[];
    const pro = plans.find((p) => p.code === "PRO")!;
    try {
      const updated = await http().patch("/v1/admin/plans/PRO").set(admin.auth).send({ priceMonthly: 10900 }).expect(200);
      expect(updated.body.priceMonthly).toBe(10900);
      const owner = await signup(app);
      const co = (await http().post("/v1/billing/checkout").set(owner.auth).send({ planCode: "PRO", interval: "MONTH" }).expect(201)).body as CheckoutResponse;
      expect(co.invoice.amount).toBe(10900);
      await http().patch("/v1/admin/plans/PRO").set(admin.auth).send({ features: ["not-a-feature"] }).expect(400);
      await http().patch("/v1/admin/plans/NOPE").set(admin.auth).send({ priceMonthly: 1 }).expect(404);
    } finally {
      await http().patch("/v1/admin/plans/PRO").set(admin.auth).send({ priceMonthly: pro.priceMonthly }).expect(200);
    }
  });

  it("invoices across companies with status filter", async () => {
    const owner = await paidCompany("Faktura Bax MMC");
    const number = (await detail(await tenantOf(owner))).invoices[0]!.number;
    const paid = (await http().get("/v1/admin/invoices").query({ status: "PAID" }).set(admin.auth).expect(200)).body;
    const row = paid.items.find((i: { number: string }) => i.number === number);
    expect(row).toMatchObject({ company: "Faktura Bax MMC", status: "PAID", amount: 9900 });
    expect(paid.totals.paid).toBeGreaterThanOrEqual(9900);
    const open = (await http().get("/v1/admin/invoices").query({ status: "OPEN" }).set(admin.auth).expect(200)).body;
    expect(open.items.every((i: { status: string }) => i.status === "OPEN")).toBe(true);
  });

  it("support tickets: company ↔ platform thread, visibility, notification, reopen; isolated between companies", async () => {
    const owner = await signup(app, "Dəstək İstəyən");
    const emp = await addMember(app, owner, "EMPLOYEE");
    const other = await addMember(app, owner, "EMPLOYEE");
    const stranger = await signup(app);

    const created = (await http().post("/v1/support/tickets").set(emp.auth).send({ subject: "Kanal qoşulmur", body: "WhatsApp xətası verir", priority: "HIGH" }).expect(201)).body as TicketDto;
    expect(created).toMatchObject({ status: "open", priority: "HIGH", messages: [{ body: "WhatsApp xətası verir", fromStaff: false }] });

    // Author and owner see it; a colleague and another company don't
    expect(((await http().get("/v1/support/tickets").set(owner.auth).expect(200)).body as TicketDto[]).map((t) => t.id)).toContain(created.id);
    expect(((await http().get("/v1/support/tickets").set(other.auth).expect(200)).body as TicketDto[]).map((t) => t.id)).not.toContain(created.id);
    await http().get(`/v1/support/tickets/${created.id}`).set(other.auth).expect(404);
    await http().get(`/v1/support/tickets/${created.id}`).set(stranger.auth).expect(404);
    await http().post(`/v1/support/tickets/${created.id}/messages`).set(stranger.auth).send({ body: "x" }).expect(404);

    // Platform support sees it with the company, answers, the author is notified
    const queue = (await http().get("/v1/admin/tickets").set(support.auth).expect(200)).body as TicketDto[];
    expect(queue.find((t) => t.id === created.id)).toMatchObject({ tenant: { name: "Dəstək İstəyən" } });
    const answered = (await http().post(`/v1/admin/tickets/${created.id}/messages`).set(support.auth).send({ body: "Token yenilənməlidir" }).expect(201)).body as TicketDto;
    expect(answered.status).toBe("in_progress");
    expect(answered.messages!.at(-1)).toMatchObject({ fromStaff: true, author: "Staff SUPPORT" });
    const notes = (await http().get("/v1/notifications").set(emp.auth).expect(200)).body.items as { type: string; payload: { ticketId?: string } }[];
    expect(notes.find((n) => n.type === "support_reply")?.payload.ticketId).toBe(created.id);
    // The company sees the reply as coming from "Axis", not a staff member's name
    const seen = (await http().get(`/v1/support/tickets/${created.id}`).set(emp.auth).expect(200)).body as TicketDto;
    expect(seen.messages!.at(-1)).toMatchObject({ fromStaff: true, author: "Axis", body: "Token yenilənməlidir" });

    // Closed, then the company writes again → reopened
    await http().patch(`/v1/admin/tickets/${created.id}`).set(support.auth).send({ status: "closed" }).expect(200);
    const reopened = (await http().post(`/v1/support/tickets/${created.id}/messages`).set(emp.auth).send({ body: "Yenə alınmır" }).expect(201)).body as TicketDto;
    expect(reopened.status).toBe("open");
    await http().patch(`/v1/admin/tickets/${created.id}`).set(support.auth).send({}).expect(400);
  });

  it("priority support: companies whose plan includes it are first in the queue", async () => {
    const pro = await paidCompany("Adi Növbə MMC", "PRO");
    const business = await paidCompany("Prioritet MMC", "BUSINESS");
    const t1 = (await http().post("/v1/support/tickets").set(pro.auth).send({ subject: "Adi sual", body: "Kömək lazımdır" }).expect(201)).body as TicketDto;
    const t2 = (await http().post("/v1/support/tickets").set(business.auth).send({ subject: "Prioritet sual", body: "Kömək lazımdır" }).expect(201)).body as TicketDto;
    // The ordinary ticket is newer, yet the priority one comes first
    await http().post(`/v1/support/tickets/${t1.id}/messages`).set(pro.auth).send({ body: "Yenilədim" }).expect(201);
    const queue = (await http().get("/v1/admin/tickets").set(support.auth).expect(200)).body as TicketDto[];
    const pos = (id: string) => queue.findIndex((t) => t.id === id);
    expect(queue[pos(t2.id)]!.tenant).toMatchObject({ name: "Prioritet MMC", prioritySupport: true });
    expect(queue[pos(t1.id)]!.tenant!.prioritySupport).toBe(false);
    expect(pos(t2.id)).toBeLessThan(pos(t1.id));
  });

  it("suspended companies can still ask for help", async () => {
    const owner = await paidCompany("Dayanıb Kömək");
    await http().post(`/v1/admin/tenants/${await tenantOf(owner)}/suspend`).set(admin.auth).send({ reason: "test" }).expect(204);
    await http().post("/v1/support/tickets").set(owner.auth).send({ subject: "Hesab bağlandı", body: "Niyə dayandırıldı?" }).expect(201);
  });

  it("system health: database, jobs and billing provider", async () => {
    const s = (await http().get("/v1/admin/system").set(admin.auth).expect(200)).body as SystemHealthDto;
    expect(s.db.ok).toBe(true);
    expect(s.jobs.map((j) => j.name).sort()).toEqual(["automations", "billing", "overdue-tasks"]);
    expect(s.billingProvider).toBe("demo");
    expect(s.uptimeSec).toBeGreaterThanOrEqual(0);
  });
});
