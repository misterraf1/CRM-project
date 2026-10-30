import "./manual-billing-env";
import type { AdminPlanDto, AdminTenantDetail, BillingOverviewDto } from "@/shared";
import request from "supertest";
import { BillingJob } from "@/server/billing/billing.job";
import { createApp, platformStaff, signup, uniqueEmail, withRawDb, type Company, type TestApp } from "./helpers";

const DAY = 86_400_000;
const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

describe("Platform-managed subscriptions (manual billing)", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());
  let admin: Awaited<ReturnType<typeof platformStaff>>;
  let support: Awaited<ReturnType<typeof platformStaff>>;

  beforeAll(async () => {
    app = await createApp();
    admin = await platformStaff(app, "SUPER_ADMIN");
    support = await platformStaff(app, "SUPPORT");
  });
  afterAll(() => app.close());

  const tenantOf = async (who: Company) => (await http().get("/v1/me").set(who.auth)).body.tenant.id as string;
  const billing = async (who: Company) => (await http().get("/v1/billing").set(who.auth).expect(200)).body as BillingOverviewDto;
  const detail = async (id: string) => (await http().get(`/v1/admin/tenants/${id}`).set(admin.auth).expect(200)).body as AdminTenantDetail;
  const setSubscription = (id: string, body: object) => http().post(`/v1/admin/tenants/${id}/subscription`).set(admin.auth).send(body);
  const setLimits = (id: string, body: object) =>
    http()
      .post(`/v1/admin/tenants/${id}/limits`)
      .set(admin.auth)
      .send({ seatLimit: null, storageMb: null, aiCredits: null, contactLimit: "plan", automationLimit: "plan", featureGrants: [], ...body });
  const notices = async (who: Company) => ((await http().get("/v1/notifications").set(who.auth)).body.items as { type: string }[]).map((n) => n.type);

  const planBody = (code: string, extra: object = {}) => ({
    code,
    name: `Paket ${code}`,
    priceMonthly: 5000,
    priceYearly: 50000,
    seatLimit: 5,
    storageMb: 1024,
    extraSeatPrice: 500,
    extraStorageGbPrice: 300,
    aiCredits: 0,
    features: ["crm.basic", "tasks"],
    contactLimit: null,
    automationLimit: null,
    isPublic: false,
    sortOrder: 10,
    ...extra,
  });

  it("companies have no checkout: plans and payments are the platform's", async () => {
    const owner = await signup(app, "Manual MMC");
    const b = await billing(owner);
    expect(b.provider).toBe("manual");
    expect(b.usage.contacts).toEqual({ used: 0, limit: null });
    for (const [path, body] of [
      ["/v1/billing/checkout", { planCode: "PRO", interval: "MONTH" }],
      ["/v1/billing/addons", { extraSeats: 1, extraStorageGb: 0 }],
      ["/v1/billing/downgrade", { planCode: "START" }],
    ] as const) {
      const res = await http().post(path).set(owner.auth).send(body).expect(409);
      expect(res.body.error.code).toBe("BILLING_MANUAL");
    }
    await http().post("/v1/billing/demo/next-charge").set(owner.auth).send({ fails: true }).expect(404);
  });

  it("Super Admin creates plans with contact and automation limits; support staff only read", async () => {
    const code = `gift${Date.now().toString(36).slice(-6)}`;
    const created = (await http().post("/v1/admin/plans").set(admin.auth).send(planBody(code.toUpperCase(), { contactLimit: 100 })).expect(201)).body as AdminPlanDto;
    expect(created).toMatchObject({ code, contactLimit: 100, automationLimit: null, isPublic: false, tenants: 0 });
    await http().post("/v1/admin/plans").set(admin.auth).send(planBody(code)).expect(409);
    await http().post("/v1/admin/plans").set(admin.auth).send(planBody("bad code!")).expect(400);
    await http().post("/v1/admin/plans").set(support.auth).send(planBody(`${code}x`)).expect(403);

    const updated = (await http().patch(`/v1/admin/plans/${code}`).set(admin.auth).send({ automationLimit: 3, contactLimit: null }).expect(200)).body as AdminPlanDto;
    expect(updated).toMatchObject({ contactLimit: null, automationLimit: 3 });
    // Private plans aren't offered to companies
    const owner = await signup(app);
    expect((await billing(owner)).plans.map((p) => p.code)).not.toContain(code);
  });

  it("activating by hand: a recorded payment becomes a paid invoice, revenue and history", async () => {
    const owner = await signup(app, "Köçürmə MMC");
    const id = await tenantOf(owner);
    const before = (await http().get("/v1/admin/overview").set(admin.auth)).body;

    await setSubscription(id, { planCode: "PRO", interval: "MONTH", periodEnd: isoDate(-1), amount: 9900 }).expect(400);
    await setSubscription(id, { planCode: "NOPE", interval: "MONTH", periodEnd: isoDate(30), amount: 9900 }).expect(400);
    await http().post(`/v1/admin/tenants/${id}/subscription`).set(support.auth).send({ planCode: "PRO", interval: "MONTH", periodEnd: isoDate(30), amount: 9900 }).expect(403);
    await setSubscription(id, { planCode: "PRO", interval: "MONTH", periodEnd: isoDate(30), amount: 9900, reference: "BANK-2026-001" }).expect(204);

    const b = await billing(owner);
    expect(b.subscription).toMatchObject({ status: "ACTIVE", plan: { code: "PRO" }, interval: "MONTH", trialEndsAt: null });
    expect(b.subscription.currentPeriodEnd.slice(0, 10)).toBe(isoDate(30));
    expect(b.invoices[0]).toMatchObject({ kind: "manual", status: "PAID", amount: 9900, payments: [{ provider: "manual", status: "succeeded" }] });
    // Out of the trial: the plan's features, no longer everything
    expect(b.features).not.toContain("automations");
    expect(await notices(owner)).toContain("billing_paid");

    const after = (await http().get("/v1/admin/overview").set(admin.auth)).body;
    expect(after.mrr - before.mrr).toBe(9900);
    expect(after.revenue30d - before.revenue30d).toBe(9900);
    const d = await detail(id);
    expect(d.history[0]).toMatchObject({ action: "platform.subscription_set", actor: "Staff SUPER_ADMIN" });
    expect(d.history[0]!.diff).toMatchObject({ plan: { from: "BUSINESS", to: "PRO" }, status: { from: "TRIALING", to: "ACTIVE" }, amount: 9900, reference: "BANK-2026-001" });

    // Extending keeps the running period's start
    const start = b.subscription.currentPeriodStart;
    await setSubscription(id, { planCode: "PRO", interval: "MONTH", periodEnd: isoDate(60), amount: 9900 }).expect(204);
    const extended = await billing(owner);
    expect(extended.subscription.currentPeriodStart).toBe(start);
    expect(extended.subscription.currentPeriodEnd.slice(0, 10)).toBe(isoDate(60));
  });

  it("a gift period brings no revenue", async () => {
    const owner = await signup(app);
    const id = await tenantOf(owner);
    const before = (await http().get("/v1/admin/overview").set(admin.auth)).body;
    await setSubscription(id, { planCode: "BUSINESS", interval: "YEAR", periodEnd: isoDate(365), amount: 0, note: "Tərəfdaş" }).expect(204);
    const d = await detail(id);
    expect(d).toMatchObject({ status: "ACTIVE", plan: "BUSINESS", mrr: 0, complimentary: true });
    expect(d.invoices[0]).toMatchObject({ kind: "gift", status: "PAID", amount: 0, payments: [] });
    const after = (await http().get("/v1/admin/overview").set(admin.auth)).body;
    expect(after.mrr).toBe(before.mrr);
    expect(await notices(owner)).not.toContain("billing_paid");
  });

  it("limits: plan contact limit, company overrides, seats; temporary features", async () => {
    const code = `lim${Date.now().toString(36).slice(-6)}`;
    await http().post("/v1/admin/plans").set(admin.auth).send(planBody(code, { contactLimit: 2, automationLimit: 0, seatLimit: 2 })).expect(201);
    const owner = await signup(app);
    const id = await tenantOf(owner);
    await setSubscription(id, { planCode: code, interval: "MONTH", periodEnd: isoDate(30), amount: 5000 }).expect(204);

    await http().post("/v1/contacts").set(owner.auth).send({ name: "Bir" }).expect(201);
    await http().post("/v1/contacts").set(owner.auth).send({ name: "İki", type: "company" }).expect(201);
    const full = await http().post("/v1/contacts").set(owner.auth).send({ name: "Üç" }).expect(402);
    expect(full.body.error).toMatchObject({ code: "PLAN_LIMIT", details: { resource: "contacts", used: 2, limit: 2 } });
    // Imports respect it too, all or nothing
    const csv = Buffer.from("Ad\nA\nB\n");
    const imp = await http().post("/v1/imports").set(owner.auth).field("options", JSON.stringify({ entity: "person", duplicates: "skip" })).attach("file", csv, "x.csv").expect(402);
    expect(imp.body.error.details).toMatchObject({ resource: "contacts", adding: 2 });

    // The company gets more (unlimited) without changing the plan
    await setLimits(id, { contactLimit: null, seatLimit: 1 }).expect(204);
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Üç" }).expect(201);
    const seats = await http().post("/v1/members/invites").set(owner.auth).send({ email: uniqueEmail("seat"), role: "EMPLOYEE" }).expect(402);
    expect(seats.body.error).toMatchObject({ code: "SEAT_LIMIT", details: { used: 1, limit: 1 } });
    let d = await detail(id);
    expect(d.limits).toMatchObject({ seats: 1, contacts: null, automations: 0, storageMb: 1024 });
    expect(d.overrides).toEqual({ seatLimit: 1, contactLimit: null });

    // Automations aren't in this plan: granted until a date, they work; expired, they don't
    await http().get("/v1/automations").set(owner.auth).expect(402);
    await setLimits(id, { automationLimit: 1, featureGrants: [{ feature: "automations", until: isoDate(7) }] }).expect(204);
    await http().get("/v1/automations").set(owner.auth).expect(200);
    const rule = { name: "Yeni lead", trigger: "task.overdue", actions: [{ type: "notify", recipient: "managers", message: "Gecikir: {title}" }] };
    await http().post("/v1/automations").set(owner.auth).send(rule).expect(201);
    const over = await http().post("/v1/automations").set(owner.auth).send({ ...rule, name: "İkinci" }).expect(402);
    expect(over.body.error.details).toMatchObject({ resource: "automations", limit: 1 });
    d = await detail(id);
    expect(d.featureGrants).toEqual([{ feature: "automations", until: expect.stringContaining(isoDate(7)), active: true }]);
    expect(d.features).toContain("automations");

    await setLimits(id, { featureGrants: [{ feature: "automations", until: isoDate(-1) }] }).expect(204);
    await http().get("/v1/automations").set(owner.auth).expect(402);
    // Back to the plan: overrides cleared (contacts limited again)
    d = await detail(id);
    expect(d.overrides).toEqual({});
    expect(d.limits.contacts).toBe(2);
    expect(d.history.map((h) => h.action)).toEqual(expect.arrayContaining(["platform.limits_set", "platform.subscription_set"]));
  });

  it("period end without online payment: renewal invoice, grace, suspension — until the platform extends it", async () => {
    const owner = await signup(app);
    const id = await tenantOf(owner);
    await setSubscription(id, { planCode: "PRO", interval: "MONTH", periodEnd: isoDate(30), amount: 9900 }).expect(204);
    await withRawDb((db) => db.subscription.update({ tenantId: id }, { $set: { currentPeriodEnd: new Date(Date.now() - 60_000) } }));
    await app.get(BillingJob).processTenant(id);

    let b = await billing(owner);
    expect(b.subscription.status).toBe("PAST_DUE");
    expect(b.subscription.graceEndsAt).not.toBeNull();
    expect(b.invoices[0]).toMatchObject({ kind: "renewal", status: "OPEN", amount: 9900, payments: [] });
    expect(await notices(owner)).toContain("billing_period_ended");
    // Nothing to pay online
    expect((await http().post(`/v1/billing/invoices/${b.invoices[0]!.id}/pay`).set(owner.auth).expect(409)).body.error.code).toBe("BILLING_MANUAL");

    await withRawDb((db) => db.subscription.update({ tenantId: id }, { $set: { graceEndsAt: new Date(Date.now() - 60_000) } }));
    await app.get(BillingJob).processTenant(id);
    expect((await billing(owner)).subscription.status).toBe("SUSPENDED");
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Bloklanıb" }).expect(402);

    await setSubscription(id, { planCode: "PRO", interval: "MONTH", periodEnd: isoDate(30), amount: 9900, reference: "BANK-2" }).expect(204);
    b = await billing(owner);
    expect(b.subscription.status).toBe("ACTIVE");
    // The renewal invoice is settled by the recorded payment, not left open
    expect(b.invoices.map((i) => `${i.kind}:${i.status}`)).toEqual(["manual:PAID", "manual:PAID"]);
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Yenidən aktiv" }).expect(201);
  });
});
