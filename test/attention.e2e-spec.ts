import type { AttentionItemDto, ContactDto, DashboardCrmDto, DealDto, DocDto, DuplicateMatchesDto } from "@/shared";
import { MongoClient } from "mongodb";
import request from "supertest";
import { OverdueJob } from "@/server/tasks/overdue.job";
import { addMember, createApp, signup, type TestApp } from "./helpers";

const DAY = 86_400_000;
const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

describe("Needs attention, duplicates, expected payments", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  type Who = { auth: { authorization: string } };
  const contact = async (who: Who, body: object) => (await http().post("/v1/contacts").set(who.auth).send(body).expect(201)).body as ContactDto;
  const attention = async (who: Who) => (await http().get("/v1/dashboard/attention").set(who.auth).expect(200)).body as AttentionItemDto[];
  const lines = [{ name: "Xidmət", quantity: 1, unit: "ədəd", unitPrice: 10_000 }];

  it("duplicates: same email or phone (any format) is flagged; colleagues' contacts are only counted", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const a = await contact(owner, { name: "Aysel", email: "aysel@x.az", phone: "+994501234567" });
    let res = (await http().get("/v1/contacts/duplicates?phone=050%20123%2045%2067").set(owner.auth).expect(200)).body as DuplicateMatchesDto;
    expect(res).toEqual({ items: [{ id: a.id, name: "Aysel", email: "aysel@x.az", phone: "+994501234567", match: "phone" }], hidden: 0 });
    res = (await http().get("/v1/contacts/duplicates?email=AYSEL@x.az").set(owner.auth).expect(200)).body as DuplicateMatchesDto;
    expect(res.items[0]).toMatchObject({ id: a.id, match: "email" });
    // Editing the contact itself is not a duplicate
    expect((await http().get(`/v1/contacts/duplicates?email=aysel@x.az&excludeId=${a.id}`).set(owner.auth)).body).toEqual({ items: [], hidden: 0 });
    // The employee doesn't see the owner's contact: no name, just a count
    expect((await http().get("/v1/contacts/duplicates?email=aysel@x.az").set(emp.auth).expect(200)).body).toEqual({ items: [], hidden: 1 });
    expect((await http().get("/v1/contacts/duplicates?phone=12").set(owner.auth)).body).toEqual({ items: [], hidden: 0 });
  });

  it("each rule lists work with its reason; a planned task takes it off the list", async () => {
    const owner = await signup(app);
    const tenantId = (await http().get("/v1/me").set(owner.auth)).body.tenant.id as string;
    const c = await contact(owner, { name: "Unudulmuş müştəri" });
    const deal = (await http().post("/v1/deals").set(owner.auth).send({ title: "Köhnə satış", amount: 5000, contactId: c.id }).expect(201)).body as DealDto;
    const quote = (await http().post("/v1/docs").set(owner.auth).send({ kind: "quote", contactId: c.id, currency: "AZN", lines }).expect(201)).body as DocDto;
    await http().post(`/v1/docs/${quote.id}/send`).set(owner.auth).send({ email: false }).expect(200);
    const inv = (await http().post("/v1/docs").set(owner.auth).send({ kind: "invoice", contactId: c.id, currency: "AZN", dueDate: isoDate(-3), lines }).expect(201)).body as DocDto;
    await http().post(`/v1/docs/${inv.id}/send`).set(owner.auth).send({ email: false }).expect(200);
    const soon = (await http().post("/v1/docs").set(owner.auth).send({ kind: "quote", contactId: c.id, currency: "AZN", dueDate: isoDate(1), lines }).expect(201)).body as DocDto;
    await http().post(`/v1/docs/${soon.id}/send`).set(owner.auth).send({ email: false }).expect(200);

    // Age the records: quote sent 3 days ago, deal untouched for 10 days
    // (raw driver: the repository would stamp a fresh updatedAt)
    const client = await MongoClient.connect(process.env.DATABASE_URL!);
    try {
      await client.db().collection("SalesDoc").updateOne({ _id: quote.id as never }, { $set: { sentAt: new Date(Date.now() - 3 * DAY) } });
      await client.db().collection("Deal").updateOne({ _id: deal.id as never, tenantId }, { $set: { updatedAt: new Date(Date.now() - 10 * DAY) } });
    } finally {
      await client.close();
    }

    let items = await attention(owner);
    const reasons = (r: string) => items.filter((i) => i.reason === r);
    expect(reasons("invoice_overdue")).toEqual([expect.objectContaining({ href: `/sales/${inv.id}`, age: 3, amount: { value: 10_000, currency: "AZN" } })]);
    expect(reasons("quote_expiring").map((i) => i.href)).toEqual([`/sales/${soon.id}`]);
    expect(reasons("quote_no_followup")).toEqual([expect.objectContaining({ href: `/sales/${quote.id}`, age: 3 })]);
    expect(reasons("deal_stale")).toEqual([expect.objectContaining({ href: `/deals/${deal.id}`, age: 10 })]);
    // Urgent first
    expect(items[0]!.reason).toBe("invoice_overdue");

    // A follow-up task on the customer is a next step
    await http().post("/v1/tasks").set(owner.auth).send({ title: "Zəng et", contactId: c.id }).expect(201);
    items = await attention(owner);
    expect(items.map((i) => i.reason).sort()).toEqual(["invoice_overdue", "quote_expiring"]);

    // Someone else's view stays out
    const emp = await addMember(app, owner, "EMPLOYEE");
    expect(await attention(emp)).toEqual([]);
  });

  it("dashboard shows what customers owe; the owner is told once when an invoice is overdue", async () => {
    const owner = await signup(app);
    await http().patch("/v1/settings/currencies").set(owner.auth).send({ rates: { USD: 1.7 } }).expect(200);
    const c = await contact(owner, { name: "Borclu" });
    const make = async (currency: string, due: number) => {
      const d = (await http().post("/v1/docs").set(owner.auth).send({ kind: "invoice", contactId: c.id, currency, dueDate: isoDate(due), lines }).expect(201)).body as DocDto;
      await http().post(`/v1/docs/${d.id}/send`).set(owner.auth).send({ email: false }).expect(200);
      return d;
    };
    const late = await make("AZN", -1);
    await make("USD", 10);
    await http().post(`/v1/docs/${late.id}/payments`).set(owner.auth).send({ amount: 4_000, method: "cash", paidOn: isoDate(0) }).expect(201);

    const dash = (await http().get("/v1/dashboard?period=30d").set(owner.auth).expect(200)).body as DashboardCrmDto;
    expect(dash.payments).toEqual({ due: 6_000 + 17_000, overdue: 6_000, count: 2, overdueCount: 1 });
    const emp = await addMember(app, owner, "EMPLOYEE");
    expect(((await http().get("/v1/dashboard?period=30d").set(emp.auth)).body as DashboardCrmDto).payments).toBeNull();

    const job = app.get(OverdueJob);
    expect(await job.run()).toBeGreaterThanOrEqual(1);
    await job.run();
    const notes = ((await http().get("/v1/notifications").set(owner.auth)).body.items as { type: string; payload: { docId: string } }[]).filter((n) => n.type === "invoice_overdue");
    expect(notes.map((n) => n.payload.docId)).toEqual([late.id]);
  });
});
