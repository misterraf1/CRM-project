import type { ActivityDto, ContactDto, DealDto, DocDto, DocShareResponse, DocSummaryDto, ProductDto, PublicDocDto } from "@/shared";
import request from "supertest";
import { addMember, createApp, signup, withRawDb, type Company, type TestApp } from "./helpers";

const DAY = 86_400_000;
const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

describe("Products, quotes and invoices", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  type Who = { auth: { authorization: string } };
  const contact = async (who: Who, body: object) => (await http().post("/v1/contacts").set(who.auth).send(body).expect(201)).body as ContactDto;
  const createDoc = (who: Who, body: object) => http().post("/v1/docs").set(who.auth).send(body);
  const tokenOf = (r: DocShareResponse) => r.publicPath.replace("/p/", "");

  /** 2 × 100.00 −10% +18% VAT, and 1.5 h × 33.33 without VAT: 212.40 + 50.00 */
  const lines = [
    { name: "Konsultasiya paketi", quantity: 2, unit: "ədəd", unitPrice: 10_000, discountBp: 1_000, taxBp: 1_800 },
    { name: "Əlavə saat", quantity: 1.5, unit: "saat", unitPrice: 3_333 },
  ];

  it("catalog: managers edit it, everyone reads it; a used product is archived instead of deleted", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const p = (await http().post("/v1/products").set(owner.auth).send({ name: "Veb sayt", unit: "ədəd", price: 150_000, currency: "AZN", taxBp: 1800 }).expect(201)).body as ProductDto;
    expect(p).toMatchObject({ name: "Veb sayt", sku: null, active: true });
    await http().post("/v1/products").set(emp.auth).send({ name: "X", unit: "ədəd", price: 1, currency: "AZN" }).expect(403);
    expect(((await http().get("/v1/products").set(emp.auth).expect(200)).body as ProductDto[]).map((x) => x.name)).toEqual(["Veb sayt"]);

    const c = await contact(owner, { name: "Kataloq müştərisi" });
    await createDoc(owner, { kind: "quote", contactId: c.id, currency: "AZN", lines: [{ productId: p.id, name: p.name, quantity: 1, unit: p.unit, unitPrice: p.price }] }).expect(201);
    expect((await http().delete(`/v1/products/${p.id}`).set(owner.auth).expect(200)).body).toEqual({ archived: true });
    expect((await http().get("/v1/products").set(owner.auth)).body).toEqual([]);
    expect((await http().get("/v1/products?all=1").set(owner.auth)).body[0]).toMatchObject({ id: p.id, active: false });
    // A product of another company can't be put on a document
    const other = await signup(app);
    const foreign = (await http().post("/v1/products").set(other.auth).send({ name: "Yad", unit: "ədəd", price: 1, currency: "AZN" }).expect(201)).body as ProductDto;
    await createDoc(owner, { kind: "quote", contactId: c.id, currency: "AZN", lines: [{ productId: foreign.id, name: "Yad", quantity: 1, unit: "ədəd", unitPrice: 1 }] }).expect(400);
  });

  it("quote: totals, numbering, customer link, acceptance puts the total on the deal and tells the owner", async () => {
    const owner = await signup(app, "Təklif MMC");
    const c = await contact(owner, { name: "Aysel Məmmədova", email: "aysel@example.az" });
    const deal = (await http().post("/v1/deals").set(owner.auth).send({ title: "Sayt layihəsi", amount: 1, contactId: c.id }).expect(201)).body as DealDto;

    const quote = (await createDoc(owner, { kind: "quote", contactId: c.id, dealId: deal.id, currency: "AZN", dueDate: isoDate(14), notes: "Ödəniş 50% əvvəlcədən", lines }).expect(201)).body as DocDto;
    expect(quote).toMatchObject({ kind: "quote", status: "draft", subtotal: 25_000, discountTotal: 2_000, taxTotal: 3_240, total: 26_240, deal: { id: deal.id } });
    expect(quote.number).toMatch(/^T-\d{4}-0001$/);
    expect(quote.lines.map((l) => l.total)).toEqual([21_240, 5_000]);

    const shared = (await http().post(`/v1/docs/${quote.id}/send`).set(owner.auth).send({ email: true }).expect(200)).body as DocShareResponse;
    expect(shared.doc.status).toBe("sent");
    // No SMTP in tests: the email is kept as not sent, the link is still usable
    expect(shared.emailDelivery).toBe("not_configured");
    const mail = await withRawDb((db) => db.emailMessage.findOne({ to: "aysel@example.az" }));
    expect(mail?.subject).toContain(quote.number!);

    // The customer's view: no account, nothing internal
    const token = tokenOf(shared);
    const view = (await http().get(`/v1/public/docs/${token}`).expect(200)).body as PublicDocDto;
    expect(view).toMatchObject({ kind: "quote", number: quote.number, total: 26_240, company: { name: "Təklif MMC" }, customer: { name: "Aysel Məmmədova" } });
    expect(JSON.stringify(view)).not.toContain(deal.id);
    await http().get(`/v1/public/docs/${token}x`).expect(404);

    const answered = (await http().post(`/v1/public/docs/${token}/respond`).send({ decision: "accept", name: "Aysel Məmmədova", comment: "Razıyıq" }).expect(200)).body as PublicDocDto;
    expect(answered).toMatchObject({ status: "accepted", response: { decision: "accept", name: "Aysel Məmmədova" } });
    await http().post(`/v1/public/docs/${token}/respond`).send({ decision: "reject", name: "Başqası" }).expect(409);

    const dealAfter = (await http().get(`/v1/deals/${deal.id}`).set(owner.auth).expect(200)).body as DealDto;
    expect(dealAfter.amount).toBe(26_240);
    const notes = (await http().get("/v1/notifications").set(owner.auth)).body.items as { type: string; payload: { docId: string } }[];
    expect(notes.find((n) => n.type === "quote_accepted")?.payload.docId).toBe(quote.id);
    const timeline = (await http().get(`/v1/contacts/${c.id}/activities`).set(owner.auth)).body as ActivityDto[];
    expect(timeline.map((a) => a.type)).toEqual(expect.arrayContaining(["quote_sent", "quote_accepted"]));
    // An answered quote is final
    await http().patch(`/v1/docs/${quote.id}`).set(owner.auth).send({ contactId: c.id, currency: "AZN", lines }).expect(409);
    await http().post(`/v1/docs/${quote.id}/send`).set(owner.auth).send({ email: false }).expect(409);
  });

  it("invoice: from the quote, numbered when issued, partial and full payments, undo, void", async () => {
    const owner = await signup(app);
    const c = await contact(owner, { name: "Fakturalı müştəri" });
    const quote = (await createDoc(owner, { kind: "quote", contactId: c.id, currency: "AZN", lines }).expect(201)).body as DocDto;
    await http().post(`/v1/docs/${quote.id}/invoice`).set(owner.auth).expect(409);
    await http().post(`/v1/docs/${quote.id}/send`).set(owner.auth).send({ email: false }).expect(200);
    await http().post(`/v1/docs/${quote.id}/respond`).set(owner.auth).send({ decision: "accept" }).expect(200);

    const draft = (await http().post(`/v1/docs/${quote.id}/invoice`).set(owner.auth).expect(201)).body as DocDto;
    expect(draft).toMatchObject({ kind: "invoice", status: "draft", number: null, total: 26_240, sourceId: quote.id });
    await http().post(`/v1/docs/${draft.id}/payments`).set(owner.auth).send({ amount: 100, method: "cash", paidOn: isoDate(0) }).expect(409);

    const issued = (await http().post(`/v1/docs/${draft.id}/send`).set(owner.auth).send({ email: false }).expect(200)).body as DocShareResponse;
    expect(issued.doc.status).toBe("issued");
    expect(issued.doc.number).toMatch(/^F-\d{4}-0001$/);
    // Issued invoices are locked
    await http().patch(`/v1/docs/${draft.id}`).set(owner.auth).send({ contactId: c.id, currency: "AZN", lines }).expect(409);
    expect(((await http().get(`/v1/docs/${quote.id}`).set(owner.auth)).body as DocDto).invoices).toEqual([{ id: draft.id, number: issued.doc.number, status: "issued" }]);

    let inv = (await http().post(`/v1/docs/${draft.id}/payments`).set(owner.auth).send({ amount: 10_000, method: "transfer", paidOn: isoDate(0), reference: "PP-1" }).expect(201)).body as DocDto;
    expect(inv).toMatchObject({ status: "issued", paidAmount: 10_000 });
    await http().post(`/v1/docs/${draft.id}/payments`).set(owner.auth).send({ amount: 20_000, method: "cash", paidOn: isoDate(0) }).expect(400);
    await http().post(`/v1/docs/${draft.id}/void`).set(owner.auth).expect(409);
    inv = (await http().post(`/v1/docs/${draft.id}/payments`).set(owner.auth).send({ amount: 16_240, method: "cash", paidOn: isoDate(0) }).expect(201)).body as DocDto;
    expect(inv).toMatchObject({ status: "paid", paidAmount: 26_240 });
    expect(inv.payments.map((p) => p.amount)).toEqual([10_000, 16_240]);
    expect((await http().get(`/v1/public/docs/${tokenOf(issued)}`).expect(200)).body).toMatchObject({ status: "paid", paidAmount: 26_240 });

    inv = (await http().delete(`/v1/docs/${draft.id}/payments/${inv.payments[1]!.id}`).set(owner.auth).expect(200)).body as DocDto;
    expect(inv).toMatchObject({ status: "issued", paidAmount: 10_000 });

    // Voiding: only without payments; the link stops working
    const second = (await createDoc(owner, { kind: "invoice", contactId: c.id, currency: "AZN", dueDate: isoDate(-1), lines }).expect(201)).body as DocDto;
    const sent = (await http().post(`/v1/docs/${second.id}/send`).set(owner.auth).send({ email: false }).expect(200)).body as DocShareResponse;
    expect(sent.doc.number).toMatch(/-0002$/);
    expect(sent.doc.overdue).toBe(true);
    const overdue = (await http().get("/v1/docs?kind=invoice&status=overdue").set(owner.auth).expect(200)).body as DocSummaryDto[];
    expect(overdue.map((d) => d.id)).toEqual([second.id]);
    expect(((await http().post(`/v1/docs/${second.id}/void`).set(owner.auth).expect(200)).body as DocDto).status).toBe("void");
    await http().get(`/v1/public/docs/${tokenOf(sent)}`).expect(404);
    await http().delete(`/v1/docs/${second.id}`).set(owner.auth).expect(409);
  });

  it("rights: employees write their own quotes; invoices and the company-wide view are finance's", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const mine = await contact(emp, { name: "İşçinin müştərisi" });
    const theirs = await contact(owner, { name: "Sahibin müştərisi" });

    const q = (await createDoc(emp, { kind: "quote", contactId: mine.id, currency: "AZN", lines }).expect(201)).body as DocDto;
    // A customer the employee can't see can't be quoted
    await createDoc(emp, { kind: "quote", contactId: theirs.id, currency: "AZN", lines }).expect(400);
    const ownerQuote = (await createDoc(owner, { kind: "quote", contactId: theirs.id, currency: "AZN", lines }).expect(201)).body as DocDto;
    await http().get(`/v1/docs/${ownerQuote.id}`).set(emp.auth).expect(404);
    expect(((await http().get("/v1/docs?kind=quote").set(emp.auth).expect(200)).body as DocSummaryDto[]).map((d) => d.id)).toEqual([q.id]);
    expect(((await http().get("/v1/docs?kind=quote").set(owner.auth).expect(200)).body as DocSummaryDto[]).length).toBe(2);

    await createDoc(emp, { kind: "invoice", contactId: mine.id, currency: "AZN", lines }).expect(403);
    await http().get("/v1/docs?kind=invoice").set(emp.auth).expect(403);
    await http().post(`/v1/docs/${q.id}/send`).set(emp.auth).send({ email: false }).expect(200);
    await http().post(`/v1/docs/${q.id}/invoice`).set(emp.auth).expect(403);

    // A draft can be deleted by its writer
    const draft = (await createDoc(emp, { kind: "quote", contactId: mine.id, currency: "AZN", lines }).expect(201)).body as DocDto;
    await http().delete(`/v1/docs/${draft.id}`).set(emp.auth).expect(204);
  });

  it("expired quotes can't be accepted; other currencies need a rate; links are bound to their company", async () => {
    const owner = await signup(app);
    const c = await contact(owner, { name: "Gecikən müştəri" });
    await createDoc(owner, { kind: "quote", contactId: c.id, currency: "USD", lines }).expect(400);
    await http().patch("/v1/settings/currencies").set(owner.auth).send({ rates: { USD: 1.7 } }).expect(200);
    const usd = (await createDoc(owner, { kind: "quote", contactId: c.id, currency: "USD", dueDate: isoDate(-2), lines }).expect(201)).body as DocDto;
    expect(usd.currency).toBe("USD");
    expect(await withRawDb(async (db) => (await db.salesDoc.get({ id: usd.id })).baseTotal)).toBe(Math.round(26_240 * 1.7));

    const shared = (await http().post(`/v1/docs/${usd.id}/send`).set(owner.auth).send({ email: true }).expect(200)).body as DocShareResponse;
    // The contact has no email: the link is made, nothing is sent
    expect(shared.emailDelivery).toBe("no_email");
    expect(shared.doc.expired).toBe(true);
    const late = await http().post(`/v1/public/docs/${tokenOf(shared)}/respond`).send({ decision: "accept", name: "Gecikən" }).expect(409);
    expect(late.body.error.details).toEqual({ expired: true });
    expect(((await http().get("/v1/docs?kind=quote&status=expired").set(owner.auth)).body as DocSummaryDto[]).map((d) => d.id)).toEqual([usd.id]);

    // The same secret under another company's id finds nothing
    const other = await signup(app);
    const otherTenant = (await http().get("/v1/me").set(other.auth)).body.tenant.id as string;
    const secret = tokenOf(shared).split(".")[1];
    await http().get(`/v1/public/docs/${otherTenant}.${secret}`).expect(404);

    // A new link replaces the old one
    const again = (await http().post(`/v1/docs/${usd.id}/send`).set(owner.auth).send({ email: false }).expect(200)).body as DocShareResponse;
    await http().get(`/v1/public/docs/${tokenOf(shared)}`).expect(404);
    await http().get(`/v1/public/docs/${tokenOf(again)}`).expect(200);
  });

  it("document details printed on documents: company settings, editable with CRM rights", async () => {
    const owner: Company = await signup(app, "Rekvizit MMC");
    const emp = await addMember(app, owner, "EMPLOYEE");
    const body = { legalName: "Rekvizit MMC", taxId: "1234567891", address: "Bakı, Nizami küç. 1", bankDetails: "Kapital Bank\nAZ00 0000", terms: "Ödəniş 5 iş günü ərzində" };
    await http().patch("/v1/settings/documents").set(emp.auth).send(body).expect(403);
    expect((await http().patch("/v1/settings/documents").set(owner.auth).send(body).expect(200)).body).toEqual(body);
    const c = await contact(owner, { name: "Rekvizit müştərisi" });
    const q = (await createDoc(owner, { kind: "quote", contactId: c.id, currency: "AZN", lines }).expect(201)).body as DocDto;
    const shared = (await http().post(`/v1/docs/${q.id}/send`).set(owner.auth).send({ email: false }).expect(200)).body as DocShareResponse;
    expect((await http().get(`/v1/public/docs/${tokenOf(shared)}`).expect(200)).body.company).toEqual({ name: "Rekvizit MMC", ...body });
  });
});
