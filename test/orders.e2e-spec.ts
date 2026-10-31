import type { AttentionItemDto, ContactDto, DocDto, DocSettings, DocShareResponse, OrderDto, OrderSummaryDto, ProductDto, PublicDocDto } from "@/shared";
import request from "supertest";
import { addMember, createApp, signup, withRawDb, type TestApp } from "./helpers";

const DAY = 86_400_000;
// Company calendar days (Baku), as the API counts them
const isoDate = (offsetDays: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku" }).format(new Date(Date.now() + offsetDays * DAY));
// 1×1 transparent PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("Orders, discount approval, logo, bundles, reminders", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  type Who = { auth: { authorization: string } };
  const contact = async (who: Who, body: object) => (await http().post("/v1/contacts").set(who.auth).send(body).expect(201)).body as ContactDto;
  const lines = (discountBp = 0) => [{ name: "Pəncərə", quantity: 3, unit: "ədəd", unitPrice: 20_000, discountBp }];
  const sentQuote = async (who: Who, contactId: string) => {
    const q = (await http().post("/v1/docs").set(who.auth).send({ kind: "quote", contactId, currency: "AZN", lines: lines() }).expect(201)).body as DocDto;
    return (await http().post(`/v1/docs/${q.id}/send`).set(who.auth).send({ email: false }).expect(200)).body as DocShareResponse;
  };

  it("order from a quote: steps with owners and dates, status follows the steps, the customer sees the progress", async () => {
    const owner = await signup(app);
    const worker = await addMember(app, owner, "EMPLOYEE");
    const c = await contact(owner, { name: "Pəncərə müştərisi" });
    const shared = await sentQuote(owner, c.id);

    const order = (
      await http()
        .post("/v1/orders")
        .set(owner.auth)
        .send({
          title: "3 pəncərə",
          contactId: c.id,
          quoteId: shared.doc.id,
          deliveryDate: isoDate(14),
          steps: [{ title: "Ölçü", assigneeId: worker.memberId, dueDate: isoDate(2) }, { title: "İstehsal" }, { title: "Quraşdırma" }],
        })
        .expect(201)
    ).body as OrderDto;
    expect(order).toMatchObject({ status: "new", total: 60_000, currency: "AZN", quote: { id: shared.doc.id }, progress: { done: 0, total: 3 } });
    expect(order.number).toMatch(/^S-\d{4}-0001$/);
    expect(order.steps[0]).toMatchObject({ title: "Ölçü", assignee: { id: worker.memberId }, doneAt: null });
    const notes = (await http().get("/v1/notifications").set(worker.auth)).body.items as { type: string }[];
    expect(notes.map((n) => n.type)).toContain("order_step_assigned");
    expect(((await http().get(`/v1/docs/${shared.doc.id}`).set(owner.auth)).body as DocDto).orders).toEqual([{ id: order.id, number: order.number, status: "new" }]);

    // Ticking steps moves the status; all done = done (and back when reopened)
    let o = (await http().patch(`/v1/orders/${order.id}/steps/${order.steps[0]!.id}`).set(owner.auth).send({ done: true }).expect(200)).body as OrderDto;
    expect(o).toMatchObject({ status: "in_progress", progress: { done: 1, total: 3 } });
    expect(o.steps[0]!.doneBy).toBe("Test Sahib");

    // The customer sees the steps on their quote link, no names
    const view = (await http().get(`/v1/public/docs/${shared.publicPath.replace("/p/", "")}`).expect(200)).body as PublicDocDto;
    expect(view.order).toEqual({ number: order.number, status: "in_progress", deliveryDate: expect.any(String), dueDate: null, steps: [
      { title: "Ölçü", done: true, dueDate: expect.any(String) },
      { title: "İstehsal", done: false, dueDate: null },
      { title: "Quraşdırma", done: false, dueDate: null },
    ] });
    expect(JSON.stringify(view)).not.toContain(worker.memberId);

    for (const s of o.steps.slice(1)) o = (await http().patch(`/v1/orders/${order.id}/steps/${s.id}`).set(owner.auth).send({ done: true }).expect(200)).body as OrderDto;
    expect(o.status).toBe("done");
    expect(o.completedAt).not.toBeNull();
    o = (await http().patch(`/v1/orders/${order.id}/steps/${o.steps[2]!.id}`).set(owner.auth).send({ done: false }).expect(200)).body as OrderDto;
    expect(o).toMatchObject({ status: "in_progress", completedAt: null });

    // Canceled orders are frozen until reopened; work done can't be deleted
    o = (await http().patch(`/v1/orders/${order.id}`).set(owner.auth).send({ canceled: true }).expect(200)).body as OrderDto;
    expect(o.status).toBe("canceled");
    await http().post(`/v1/orders/${order.id}/steps`).set(owner.auth).send({ title: "Əlavə" }).expect(409);
    o = (await http().patch(`/v1/orders/${order.id}`).set(owner.auth).send({ canceled: false }).expect(200)).body as OrderDto;
    expect(o.status).toBe("in_progress");
    await http().delete(`/v1/orders/${order.id}`).set(owner.auth).expect(409);
  });

  it("orders follow contact visibility; late orders show up under needs attention", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const mine = await contact(emp, { name: "İşçinin müştərisi" });
    const theirs = await contact(owner, { name: "Sahibin müştərisi" });
    const a = (await http().post("/v1/orders").set(emp.auth).send({ title: "Mənim sifarişim", contactId: mine.id, steps: [{ title: "Hazırlıq", dueDate: isoDate(-2) }] }).expect(201)).body as OrderDto;
    await http().post("/v1/orders").set(emp.auth).send({ title: "Yad", contactId: theirs.id }).expect(400);
    const b = (await http().post("/v1/orders").set(owner.auth).send({ title: "Sahibin", contactId: theirs.id }).expect(201)).body as OrderDto;
    await http().get(`/v1/orders/${b.id}`).set(emp.auth).expect(404);
    expect(((await http().get("/v1/orders").set(emp.auth).expect(200)).body as OrderSummaryDto[]).map((o) => o.id)).toEqual([a.id]);
    expect(((await http().get("/v1/orders?status=overdue").set(owner.auth)).body as OrderSummaryDto[]).length).toBe(0);
    expect(a.steps[0]!.overdue).toBe(true);

    const items = (await http().get("/v1/dashboard/attention").set(emp.auth).expect(200)).body as AttentionItemDto[];
    expect(items.find((i) => i.reason === "order_late")).toMatchObject({ href: `/orders/${a.id}`, age: 2 });
  });

  it("a discount over the company limit needs a manager's approval before the quote goes out", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const manager = await addMember(app, owner, "MANAGER");
    await http().patch("/v1/settings/documents").set(owner.auth).send({ maxDiscountBp: 1000 }).expect(200);
    const c = await contact(emp, { name: "Endirim istəyən" });
    const q = (await http().post("/v1/docs").set(emp.auth).send({ kind: "quote", contactId: c.id, currency: "AZN", lines: lines(1500) }).expect(201)).body as DocDto;
    expect(q).toMatchObject({ needsApproval: true, approval: null });

    const blocked = await http().post(`/v1/docs/${q.id}/send`).set(emp.auth).send({ email: false }).expect(409);
    expect(blocked.body.error).toMatchObject({ code: "APPROVAL_REQUIRED", details: { maxDiscountBp: 1000 } });
    await http().post(`/v1/docs/${q.id}/approval`).set(emp.auth).send({ action: "approve" }).expect(403);

    let d = (await http().post(`/v1/docs/${q.id}/approval`).set(emp.auth).send({ action: "request", note: "Daimi müştəri" }).expect(200)).body as DocDto;
    expect(d.approval).toMatchObject({ status: "pending", requestedBy: "Test EMPLOYEE", note: "Daimi müştəri" });
    // The manager is told and sees it as needing attention
    expect(((await http().get("/v1/notifications").set(manager.auth)).body.items as { type: string }[]).map((n) => n.type)).toContain("discount_approval_requested");
    // The quote belongs to the employee: the manager sees it through the approval only if in scope; the owner always
    const ownerItems = (await http().get("/v1/dashboard/attention").set(owner.auth)).body as AttentionItemDto[];
    expect(ownerItems.find((i) => i.reason === "approval_pending")?.href).toBe(`/sales/${q.id}`);

    d = (await http().post(`/v1/docs/${q.id}/approval`).set(owner.auth).send({ action: "approve" }).expect(200)).body as DocDto;
    expect(d.approval).toMatchObject({ status: "approved", decidedBy: "Test Sahib" });
    expect(((await http().get("/v1/notifications").set(emp.auth)).body.items as { type: string }[]).map((n) => n.type)).toContain("discount_approved");
    await http().post(`/v1/docs/${q.id}/send`).set(emp.auth).send({ email: false }).expect(200);

    // A bigger discount after approval needs approving again
    d = (await http().patch(`/v1/docs/${q.id}`).set(emp.auth).send({ contactId: c.id, currency: "AZN", lines: lines(2000) }).expect(200)).body as DocDto;
    expect(d.approval).toBeNull();
    await http().post(`/v1/docs/${q.id}/send`).set(emp.auth).send({ email: false }).expect(409);
    // Approvers send straight away; within the limit nothing is needed
    await http().post(`/v1/docs/${q.id}/send`).set(owner.auth).send({ email: false }).expect(200);
    const small = (await http().post("/v1/docs").set(emp.auth).send({ kind: "quote", contactId: c.id, currency: "AZN", lines: lines(1000) }).expect(201)).body as DocDto;
    expect(small.needsApproval).toBe(false);
    await http().post(`/v1/docs/${small.id}/send`).set(emp.auth).send({ email: false }).expect(200);
  });

  it("logo: only real PNG/JPEG/WebP images, shown on the customer's document; internal limits stay private", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    await http().post("/v1/settings/documents/logo").set(emp.auth).send({ dataUrl: PNG }).expect(403);
    const svg = `data:image/png;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`;
    await http().post("/v1/settings/documents/logo").set(owner.auth).send({ dataUrl: svg }).expect(400);
    const saved = (await http().post("/v1/settings/documents/logo").set(owner.auth).send({ dataUrl: PNG }).expect(200)).body as DocSettings;
    expect(saved.logo).toBe(PNG);
    // Saving the other details keeps the logo
    expect(((await http().patch("/v1/settings/documents").set(owner.auth).send({ legalName: "Loqo MMC", maxDiscountBp: 500, orderSteps: ["Ölçü", "Quraşdırma"] }).expect(200)).body as DocSettings).logo).toBe(PNG);

    const c = await contact(owner, { name: "Loqo müştərisi" });
    const shared = await sentQuote(owner, c.id);
    const view = (await http().get(`/v1/public/docs/${shared.publicPath.replace("/p/", "")}`).expect(200)).body as PublicDocDto;
    expect(view.company).toEqual({ name: expect.any(String), legalName: "Loqo MMC", taxId: null, address: null, bankDetails: null, terms: null, logo: PNG });
    expect(JSON.stringify(view)).not.toContain("maxDiscountBp");
    await http().post("/v1/settings/documents/logo").set(owner.auth).send({ dataUrl: null }).expect(200);
  });

  it("bundles: plain products of the catalog, no nesting", async () => {
    const owner = await signup(app);
    const make = (body: object) => http().post("/v1/products").set(owner.auth).send({ unit: "ədəd", currency: "AZN", ...body });
    const a = (await make({ name: "Pəncərə", price: 20_000 }).expect(201)).body as ProductDto;
    const b = (await make({ name: "Quraşdırma", price: 5_000 }).expect(201)).body as ProductDto;
    const bundle = (await make({ name: "Pəncərə + quraşdırma", price: 23_000, components: [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }] }).expect(201)).body as ProductDto;
    expect(bundle.components).toEqual([{ productId: a.id, name: "Pəncərə", quantity: 1 }, { productId: b.id, name: "Quraşdırma", quantity: 1 }]);
    await make({ name: "İç-içə", price: 1, components: [{ productId: bundle.id, quantity: 1 }] }).expect(400);
    await http().patch(`/v1/products/${a.id}`).set(owner.auth).send({ name: "Pəncərə", unit: "ədəd", currency: "AZN", price: 20_000, components: [{ productId: b.id, quantity: 1 }] }).expect(400);
  });

  it("payment reminder: emails the customer a fresh link for what is still due", async () => {
    const owner = await signup(app);
    const c = await contact(owner, { name: "Unutqan", email: "unutqan@example.az" });
    const inv = (await http().post("/v1/docs").set(owner.auth).send({ kind: "invoice", contactId: c.id, currency: "AZN", dueDate: isoDate(-1), lines: lines() }).expect(201)).body as DocDto;
    await http().post(`/v1/docs/${inv.id}/remind`).set(owner.auth).send({}).expect(409);
    await http().post(`/v1/docs/${inv.id}/send`).set(owner.auth).send({ email: false }).expect(200);
    await http().post(`/v1/docs/${inv.id}/payments`).set(owner.auth).send({ amount: 10_000, method: "cash", paidOn: isoDate(0) }).expect(201);
    const r = (await http().post(`/v1/docs/${inv.id}/remind`).set(owner.auth).send({}).expect(200)).body as DocShareResponse;
    expect(r.emailDelivery).toBe("not_configured");
    const mail = await withRawDb((db) => db.emailMessage.findOne({ to: "unutqan@example.az" }, { sort: { createdAt: -1 } }));
    expect(mail?.subject).toContain("Xatırlatma");
    expect(mail?.text).toContain("500.00 AZN");
  });
});
