import type { INestApplication } from "@nestjs/common";
import type { BillingOverviewDto, CheckoutResponse, InvoiceDto } from "@axis/shared";
import request from "supertest";
import { BillingJob } from "../src/billing/billing.job";
import { addMember, createApp, setPlan, signup, withRawDb, type Company } from "./helpers";

const DAY = 86_400_000;

describe("Billing (demo provider)", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const overview = async (who: Company) => (await http().get("/v1/billing").set(who.auth).expect(200)).body as BillingOverviewDto;
  const checkout = (who: Company, planCode: string, interval = "MONTH") => http().post("/v1/billing/checkout").set(who.auth).send({ planCode, interval });
  const complete = (who: Company, invoiceId: string, outcome: "success" | "declined") =>
    http().post(`/v1/billing/demo/invoices/${invoiceId}/complete`).set(who.auth).send({ outcome });
  const tenantOf = async (who: Company) => (await http().get("/v1/me").set(who.auth)).body.tenant.id as string;
  const notices = async (who: Company) => ((await http().get("/v1/notifications").set(who.auth)).body.items as { type: string }[]).map((n) => n.type);

  /** Company that paid for a plan through the demo checkout. */
  async function subscribed(planCode = "PRO", interval = "MONTH") {
    const owner = await signup(app);
    const co = (await checkout(owner, planCode, interval).expect(201)).body as CheckoutResponse;
    await complete(owner, co.invoice.id, "success").expect(200);
    return owner;
  }

  it("trial → checkout → demo payment activates the plan with a fresh period and a numbered invoice", async () => {
    const owner = await signup(app);
    const before = await overview(owner);
    expect(before.subscription).toMatchObject({ status: "TRIALING", plan: { code: "BUSINESS" }, paymentMethod: null });
    expect(before.provider).toBe("demo");

    const co = (await checkout(owner, "PRO").expect(201)).body as CheckoutResponse;
    expect(co.invoice).toMatchObject({ kind: "subscription", status: "OPEN", amount: 9900, currency: "AZN" });
    expect(co.invoice.number).toMatch(/^AX-\d{4}-\d{6}$/);
    expect(co.redirectUrl).toBe(`http://localhost:3000/billing/checkout/${co.invoice.id}`);

    const paid = (await complete(owner, co.invoice.id, "success").expect(200)).body as InvoiceDto;
    expect(paid).toMatchObject({ status: "PAID", payments: [{ provider: "demo", status: "succeeded" }] });
    const after = await overview(owner);
    expect(after.subscription).toMatchObject({ status: "ACTIVE", plan: { code: "PRO" }, interval: "MONTH", trialEndsAt: null, paymentMethod: { brand: "Visa", last4: "4242" } });
    const length = new Date(after.subscription.currentPeriodEnd).getTime() - new Date(after.subscription.currentPeriodStart).getTime();
    expect(length / DAY).toBeGreaterThanOrEqual(28);
    expect(length / DAY).toBeLessThanOrEqual(31);
    // Paying twice is impossible
    await complete(owner, co.invoice.id, "success").expect(404);
    expect(await notices(owner)).toContain("billing_paid");
  });

  it("declined card: attempt recorded, invoice stays payable, retry succeeds; yearly price is 10 months", async () => {
    const owner = await signup(app);
    const co = (await checkout(owner, "BUSINESS", "YEAR").expect(201)).body as CheckoutResponse;
    expect(co.invoice.amount).toBe(199000);
    const failed = (await complete(owner, co.invoice.id, "declined").expect(200)).body as InvoiceDto;
    expect(failed).toMatchObject({ status: "OPEN", payments: [{ status: "failed", failureCode: "card_declined" }] });
    expect((await overview(owner)).subscription.status).toBe("TRIALING");
    const paid = (await complete(owner, co.invoice.id, "success").expect(200)).body as InvoiceDto;
    expect(paid.status).toBe("PAID");
    expect(paid.payments.map((p) => p.status).sort()).toEqual(["failed", "succeeded"]);
    expect((await overview(owner)).subscription).toMatchObject({ status: "ACTIVE", interval: "YEAR" });
  });

  it("feature gates follow the plan; the trial unlocks everything", async () => {
    const owner = await signup(app);
    await http().get("/v1/deals").set(owner.auth).expect(200);
    await setPlan(await tenantOf(owner), "START");
    await withRawDb(async (db) => db.subscription.update({ where: { tenantId: await tenantOf(owner) }, data: { status: "ACTIVE" } }));

    const res = await http().get("/v1/deals").set(owner.auth).expect(402);
    expect(res.body.error).toMatchObject({ code: "FEATURE_NOT_IN_PLAN", details: { feature: "deals.pipeline", plan: "START" } });
    await http().get("/v1/team/stats").set(owner.auth).expect(402);
    await http().post("/v1/departments").set(owner.auth).send({ name: "Satış" }).expect(402);
    await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "WHATSAPP", name: "WA", demo: true }).expect(402);
    // What START includes keeps working
    await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "WEBCHAT", name: "Sayt" }).expect(201);
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Müştəri" }).expect(201);
    await http().post("/v1/tasks").set(owner.auth).send({ title: "İş" }).expect(201);
    expect((await http().get("/v1/me").set(owner.auth)).body.subscription.features).not.toContain("deals.pipeline");
  });

  it("upgrade mid-period is prorated and applies immediately", async () => {
    const owner = await subscribed("PRO");
    const tenantId = await tenantOf(owner);
    // Move to the middle of the period
    await withRawDb(async (db) => {
      const s = await db.subscription.findUniqueOrThrow({ where: { tenantId } });
      const len = s.currentPeriodEnd.getTime() - s.currentPeriodStart.getTime();
      await db.subscription.update({ where: { tenantId }, data: { currentPeriodStart: new Date(Date.now() - len / 2), currentPeriodEnd: new Date(Date.now() + len / 2) } });
    });
    const periodEnd = (await overview(owner)).subscription.currentPeriodEnd;
    const co = (await checkout(owner, "BUSINESS").expect(201)).body as CheckoutResponse;
    expect(co.invoice.kind).toBe("upgrade");
    expect(Math.abs(co.invoice.amount - (19900 - 9900) / 2)).toBeLessThanOrEqual(5);
    await complete(owner, co.invoice.id, "success").expect(200);
    const after = await overview(owner);
    expect(after.subscription).toMatchObject({ plan: { code: "BUSINESS" }, status: "ACTIVE", currentPeriodEnd: periodEnd });
    // Same plan again, or a cheaper one through checkout, is refused
    await checkout(owner, "BUSINESS").expect(409);
    expect((await checkout(owner, "START").expect(409)).body.error.details).toEqual({ downgrade: true });
  });

  it("downgrade waits for the period end and requires the seats to fit", async () => {
    const owner = await subscribed("PRO");
    const tenantId = await tenantOf(owner);
    const members = [];
    for (let i = 0; i < 3; i++) members.push(await addMember(app, owner, "EMPLOYEE"));
    const tooMany = await http().post("/v1/billing/downgrade").set(owner.auth).send({ planCode: "START" }).expect(402);
    expect(tooMany.body.error).toMatchObject({ code: "SEAT_LIMIT", details: { used: 4, limit: 3 } });
    await http().patch(`/v1/members/${members[0]!.memberId}`).set(owner.auth).send({ status: "DISABLED" }).expect(200);
    await http().post("/v1/billing/downgrade").set(owner.auth).send({ planCode: "START" }).expect(204);
    expect((await overview(owner)).subscription).toMatchObject({ plan: { code: "PRO" }, scheduledPlan: "START" });

    // Period ends → renewal on START at the START price
    await http().post("/v1/billing/demo/advance").set(owner.auth).expect(201);
    const after = await overview(owner);
    expect(after.subscription).toMatchObject({ plan: { code: "START" }, scheduledPlan: null, status: "ACTIVE" });
    expect(after.invoices[0]).toMatchObject({ kind: "renewal", status: "PAID", amount: 3900 });
    void tenantId;
  });

  it("renewal: success extends the period; failure → past due with grace → retries → suspended (read-only) → pay to reactivate", async () => {
    const owner = await subscribed("PRO");
    const tenantId = await tenantOf(owner);
    // "advance" moves the period end to now; the renewal must start exactly there
    await http().post("/v1/billing/demo/advance").set(owner.auth).expect(201);
    const renewed = await overview(owner);
    const renewal = renewed.invoices[0]!;
    expect(renewed.subscription.currentPeriodStart).toBe(renewal.periodStart);
    expect(renewed.subscription.currentPeriodEnd).toBe(renewal.periodEnd);
    expect((new Date(renewal.periodEnd).getTime() - new Date(renewal.periodStart).getTime()) / DAY).toBeGreaterThanOrEqual(28);
    // The real job (no demo shortcut) renews from the stored period end
    const end = new Date(Date.now() - 60_000);
    await withRawDb((db) => db.subscription.update({ where: { tenantId }, data: { currentPeriodEnd: end } }));
    await app.get(BillingJob).run();
    expect((await overview(owner)).subscription.currentPeriodStart).toBe(end.toISOString());
    expect(renewed.invoices[0]).toMatchObject({ kind: "renewal", status: "PAID", amount: 9900 });

    // Next charge fails
    await http().post("/v1/billing/demo/next-charge").set(owner.auth).send({ fails: true }).expect(204);
    await http().post("/v1/billing/demo/advance").set(owner.auth).expect(201);
    const pastDue = await overview(owner);
    expect(pastDue.subscription.status).toBe("PAST_DUE");
    expect(pastDue.subscription.graceEndsAt).not.toBeNull();
    expect(pastDue.invoices[0]).toMatchObject({ kind: "renewal", status: "FAILED" });
    expect(await notices(owner)).toContain("billing_payment_failed");
    // Still fully usable during the grace period
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Grace" }).expect(201);
    expect((await http().get("/v1/me").set(owner.auth)).body.subscription.graceEndsAt).toBe(pastDue.subscription.graceEndsAt);

    // Retries (days 1, 3, 5) all fail, then the grace period ends
    for (let i = 0; i < 3; i++) await http().post("/v1/billing/demo/advance").set(owner.auth).expect(201);
    expect((await overview(owner)).subscription.status).toBe("PAST_DUE");
    await http().post("/v1/billing/demo/advance").set(owner.auth).expect(201);
    expect((await overview(owner)).subscription.status).toBe("SUSPENDED");
    expect(await notices(owner)).toContain("billing_suspended");

    // Read-only: reads work, writes don't — except billing, which stays open
    await http().get("/v1/contacts").set(owner.auth).expect(200);
    const blocked = await http().post("/v1/contacts").set(owner.auth).send({ name: "x" }).expect(402);
    expect(blocked.body.error.code).toBe("SUBSCRIPTION_INACTIVE");
    await http().post("/v1/tasks").set(owner.auth).send({ title: "x" }).expect(402);

    // Pay the failed renewal with a working card
    await http().post("/v1/billing/demo/next-charge").set(owner.auth).send({ fails: false }).expect(204);
    const pay = (await http().post(`/v1/billing/invoices/${pastDue.invoices[0]!.id}/pay`).set(owner.auth).expect(201)).body as CheckoutResponse;
    await complete(owner, pay.invoice.id, "success").expect(200);
    const back = await overview(owner);
    expect(back.subscription).toMatchObject({ status: "ACTIVE", graceEndsAt: null });
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Yenidən" }).expect(201);
  });

  it("a retry that succeeds ends the grace period", async () => {
    const owner = await subscribed("PRO");
    await http().post("/v1/billing/demo/next-charge").set(owner.auth).send({ fails: true }).expect(204);
    await http().post("/v1/billing/demo/advance").set(owner.auth).expect(201);
    expect((await overview(owner)).subscription.status).toBe("PAST_DUE");
    await http().post("/v1/billing/demo/next-charge").set(owner.auth).send({ fails: false }).expect(204);
    await http().post("/v1/billing/demo/advance").set(owner.auth).expect(201);
    const ok = await overview(owner);
    expect(ok.subscription).toMatchObject({ status: "ACTIVE", graceEndsAt: null });
    expect(ok.invoices[0]).toMatchObject({ kind: "renewal", status: "PAID" });
  });

  it("trial: reminder 3 days before, suspended when it ends unpaid", async () => {
    const owner = await signup(app);
    const tenantId = await tenantOf(owner);
    await withRawDb((db) => db.subscription.update({ where: { tenantId }, data: { trialEndsAt: new Date(Date.now() + 2 * DAY) } }));
    await app.get(BillingJob).run();
    expect(await notices(owner)).toContain("billing_trial_ending");
    expect((await overview(owner)).subscription.status).toBe("TRIALING");
    await http().post("/v1/billing/demo/advance").set(owner.auth).expect(201);
    expect((await overview(owner)).subscription.status).toBe("SUSPENDED");
    await http().post("/v1/contacts").set(owner.auth).send({ name: "x" }).expect(402);
    // Choosing a plan reactivates
    const co = (await checkout(owner, "START").expect(201)).body as CheckoutResponse;
    await complete(owner, co.invoice.id, "success").expect(200);
    expect((await overview(owner)).subscription).toMatchObject({ status: "ACTIVE", plan: { code: "START" } });
  });

  it("cancel at period end → canceled (read-only); resume before the end keeps it", async () => {
    const owner = await subscribed("PRO");
    await http().post("/v1/billing/cancel").set(owner.auth).expect(204);
    expect((await overview(owner)).subscription.cancelAtPeriodEnd).toBe(true);
    await http().post("/v1/billing/resume").set(owner.auth).expect(204);
    expect((await overview(owner)).subscription.cancelAtPeriodEnd).toBe(false);
    await http().post("/v1/billing/cancel").set(owner.auth).expect(204);
    await http().post("/v1/billing/demo/advance").set(owner.auth).expect(201);
    expect((await overview(owner)).subscription.status).toBe("CANCELED");
    await http().post("/v1/tasks").set(owner.auth).send({ title: "x" }).expect(402);
  });

  it("add-ons: free during trial, prorated when active, reductions must fit usage", async () => {
    const owner = await signup(app);
    expect((await http().post("/v1/billing/addons").set(owner.auth).send({ extraSeats: 2, extraStorageGb: 0 }).expect(201)).body).toEqual({ applied: true });
    expect((await overview(owner)).usage.seats.limit).toBe(27);

    const active = await subscribed("PRO");
    const res = (await http().post("/v1/billing/addons").set(active.auth).send({ extraSeats: 3, extraStorageGb: 1 }).expect(201)).body as CheckoutResponse;
    expect(res.invoice.kind).toBe("addons");
    expect(res.invoice.amount).toBeGreaterThan(0);
    expect(res.invoice.amount).toBeLessThanOrEqual(3 * 900 + 500);
    await complete(active, res.invoice.id, "success").expect(200);
    const o = await overview(active);
    expect(o.subscription).toMatchObject({ extraSeats: 3, extraStorageGb: 1 });
    expect(o.usage.seats.limit).toBe(13);
    // Lowering is immediate and free
    expect((await http().post("/v1/billing/addons").set(active.auth).send({ extraSeats: 0, extraStorageGb: 0 }).expect(201)).body).toEqual({ applied: true });
  });

  it("only owners manage billing; another company's invoices are unreachable", async () => {
    const owner = await signup(app);
    const admin = await addMember(app, owner, "ADMIN");
    await http().get("/v1/billing").set(admin.auth).expect(403);
    await http().post("/v1/billing/checkout").set(admin.auth).send({ planCode: "PRO" }).expect(403);

    const other = await signup(app);
    const co = (await checkout(other, "PRO").expect(201)).body as CheckoutResponse;
    await complete(owner, co.invoice.id, "success").expect(404);
    await http().get(`/v1/billing/invoices/${co.invoice.id}`).set(owner.auth).expect(404);
    await http().get(`/v1/billing/invoices/${co.invoice.id}`).set(other.auth).expect(200);
    await checkout(owner, "NOPE").expect(400);
  });

  it("invoice numbers are unique and increasing", async () => {
    const owner = await signup(app);
    const a = (await checkout(owner, "PRO").expect(201)).body.invoice.number as string;
    const b = (await checkout(owner, "BUSINESS").expect(201)).body.invoice.number as string;
    expect(Number(b.slice(-6))).toBeGreaterThan(Number(a.slice(-6)));
  });
});
