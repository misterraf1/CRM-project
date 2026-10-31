import type { CaseDto, CaseSummaryDto, ContactDto, CustomerValueDto, DealDto, DocDto, OrderDto, PipelineDto, ProductDto, RenewalDto, TargetsDto } from "@/shared";
import request from "supertest";
import { AutomationRunner } from "@/server/automations/automation.runner";
import { Signals } from "@/server/automations/signals";
import { CasesService } from "@/server/service/cases.service";
import { RenewalsService } from "@/server/service/renewals.service";
import { addMember, createApp, signup, withRawDb, type Company, type TestApp } from "./helpers";

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

describe("After the sale: cases with warranty, renewals, targets, automation v2, lead score", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  type Who = { auth: { authorization: string } };
  const contact = async (who: Who, body: object) => (await http().post("/v1/contacts").set(who.auth).send(body).expect(201)).body as ContactDto;
  const notes = async (who: Who) => (await http().get("/v1/notifications").set(who.auth)).body.items as { type: string; payload: Record<string, string> }[];
  const pipeline = async (who: Company) => (await http().get("/v1/pipelines").set(who.auth).expect(200)).body[0] as PipelineDto;
  /** Issued invoice paid in full */
  const paidInvoice = async (who: Who, body: object) => {
    const inv = (await http().post("/v1/docs").set(who.auth).send({ kind: "invoice", currency: "AZN", ...body }).expect(201)).body as DocDto;
    await http().post(`/v1/docs/${inv.id}/send`).set(who.auth).send({ email: false }).expect(200);
    const issued = (await http().get(`/v1/docs/${inv.id}`).set(who.auth)).body as DocDto;
    await http().post(`/v1/docs/${inv.id}/payments`).set(who.auth).send({ amount: issued.total, method: "cash", paidOn: today() }).expect(201);
    return issued;
  };

  it("cases: numbered, warranty from the finished order, SLA by priority, notes, resolution on the timeline, visibility", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const c = await contact(owner, { name: "Zəmanət müştərisi" });
    const order = (await http().post("/v1/orders").set(owner.auth).send({ title: "Kondisioner", contactId: c.id, steps: [{ title: "Quraşdırma" }], warrantyMonths: 12 }).expect(201)).body as OrderDto;
    const done = (await http().patch(`/v1/orders/${order.id}/steps/${order.steps[0]!.id}`).set(owner.auth).send({ done: true }).expect(200)).body as OrderDto;
    expect(done.warrantyUntil).not.toBeNull();

    const created = (
      await http().post("/v1/cases").set(owner.auth).send({ contactId: c.id, orderId: order.id, type: "warranty", subject: "Soyutmur", priority: "HIGH", assigneeId: emp.memberId }).expect(201)
    ).body as CaseDto;
    expect(created.number).toMatch(/^M-\d{4}-0001$/);
    expect(created).toMatchObject({ status: "open", type: "warranty", warranty: { valid: true }, order: { id: order.id }, assignee: { id: emp.memberId } });
    expect(Math.round((new Date(created.dueAt).getTime() - new Date(created.createdAt).getTime()) / 3_600_000)).toBe(24);
    expect((await notes(emp)).find((n) => n.type === "case_assigned")?.payload.caseId).toBe(created.id);

    // The employee handles it (cases assigned to them) but doesn't see the owner's other cases
    const other = (await http().post("/v1/cases").set(owner.auth).send({ contactId: c.id, subject: "Sual", type: "question" }).expect(201)).body as CaseDto;
    expect(((await http().get("/v1/cases?status=active").set(emp.auth).expect(200)).body as CaseSummaryDto[]).map((x) => x.id)).toEqual([created.id]);
    await http().get(`/v1/cases/${other.id}`).set(emp.auth).expect(404);

    await http().post(`/v1/cases/${created.id}/notes`).set(emp.auth).send({ body: "Usta göndərildi" }).expect(201);
    const resolved = (await http().patch(`/v1/cases/${created.id}`).set(emp.auth).send({ status: "resolved", resolution: "Freon dolduruldu" }).expect(200)).body as CaseDto;
    expect(resolved).toMatchObject({ status: "resolved", resolution: "Freon dolduruldu", notes: [{ body: "Usta göndərildi", author: { id: emp.memberId } }] });
    expect(resolved.resolvedAt).not.toBeNull();
    const timeline = (await http().get(`/v1/contacts/${c.id}/activities`).set(owner.auth)).body as { type: string }[];
    expect(timeline.map((a) => a.type)).toEqual(expect.arrayContaining(["case_opened", "case_resolved"]));

    // Past its target: one notice
    await withRawDb((db) => db.serviceCase.update({ id: other.id }, { $set: { dueAt: new Date(Date.now() - 60_000) } }));
    expect(((await http().get("/v1/cases?status=overdue").set(owner.auth)).body as CaseSummaryDto[]).map((x) => x.id)).toEqual([other.id]);
    const cases = app.get(CasesService);
    expect(await cases.notifyOverdue()).toBeGreaterThanOrEqual(1);
    expect((await notes(owner)).filter((n) => n.type === "case_overdue" && n.payload.caseId === other.id)).toHaveLength(1);
    await cases.notifyOverdue();
    expect((await notes(owner)).filter((n) => n.type === "case_overdue" && n.payload.caseId === other.id)).toHaveLength(1);
  });

  it("renewals: a paid invoice of a recurring service schedules the next one; the owner gets a task in time; customer value", async () => {
    const owner = await signup(app);
    const c = await contact(owner, { name: "Hosting müştərisi", email: "host@example.az" });
    const product = (await http().post("/v1/products").set(owner.auth).send({ name: "Hosting (illik)", price: 12_000, currency: "AZN", renewalMonths: 12 }).expect(201)).body as ProductDto;
    expect(product.renewalMonths).toBe(12);
    await paidInvoice(owner, { contactId: c.id, lines: [{ productId: product.id, name: product.name, quantity: 1, unit: "ədəd", unitPrice: 12_000 }] });

    let renewals = (await http().get("/v1/renewals").set(owner.auth).expect(200)).body as RenewalDto[];
    expect(renewals).toHaveLength(1);
    expect(renewals[0]).toMatchObject({ productName: "Hosting (illik)", contact: { id: c.id }, status: "upcoming", amount: 12_000 });
    expect(Math.round((new Date(renewals[0]!.dueAt).getTime() - Date.now()) / DAY)).toBeGreaterThan(360);
    const value = (await http().get(`/v1/contacts/${c.id}/value`).set(owner.auth).expect(200)).body as CustomerValueDto;
    expect(value).toMatchObject({ totalPaid: 12_000, invoices: 1, upcomingRenewals: [{ id: renewals[0]!.id }] });

    // Ten days before: a task for the owner, once
    await withRawDb((db) => db.renewal.update({ id: renewals[0]!.id }, { $set: { dueAt: new Date(Date.now() + 10 * DAY) } }));
    const svc = app.get(RenewalsService);
    expect(await svc.planTasks()).toBe(1);
    expect(await svc.planTasks()).toBe(0);
    expect((await notes(owner)).some((n) => n.type === "renewal_due")).toBe(true);
    const tasks = (await http().get("/v1/tasks?view=all").set(owner.auth)).body as { title: string }[];
    expect(tasks.some((t) => t.title.includes("Hosting (illik)"))).toBe(true);

    // Paying again renews the open period and starts the next
    await paidInvoice(owner, { contactId: c.id, lines: [{ productId: product.id, name: product.name, quantity: 1, unit: "ədəd", unitPrice: 12_000 }] });
    renewals = (await http().get("/v1/renewals").set(owner.auth)).body as RenewalDto[];
    expect(renewals).toHaveLength(1);
    expect(((await http().get("/v1/renewals?status=renewed").set(owner.auth)).body as RenewalDto[]).map((r) => r.id)).not.toContain(renewals[0]!.id);
    await http().patch(`/v1/renewals/${renewals[0]!.id}`).set(owner.auth).send({ status: "lost" }).expect(200);
  });

  it("targets: company and member targets against won deals; only target managers set them", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const month = today().slice(0, 7);
    await http().post("/v1/targets").set(emp.auth).send({ memberId: null, period: "month", start: month, amount: 100_000 }).expect(403);
    await http().post("/v1/targets").set(owner.auth).send({ memberId: null, period: "quarter", start: "2026-02", amount: 1 }).expect(400);
    await http().post("/v1/targets").set(owner.auth).send({ memberId: null, period: "month", start: month, amount: 100_000 }).expect(200);
    await http().post("/v1/targets").set(owner.auth).send({ memberId: emp.memberId, period: "month", start: month, amount: 50_000 }).expect(200);

    const p = await pipeline(owner);
    const deal = (await http().post("/v1/deals").set(emp.auth).send({ title: "Böyük satış", amount: 40_000 }).expect(201)).body as DealDto;
    await http().post(`/v1/deals/${deal.id}/move`).set(emp.auth).send({ stageId: p.stages.find((s) => s.kind === "won")!.id }).expect(200);

    const all = (await http().get("/v1/targets").set(owner.auth).expect(200)).body as TargetsDto;
    expect(all.rows[0]).toMatchObject({ member: null, amount: 100_000, achieved: 40_000, percent: 40 });
    expect(all.rows.find((r) => r.member?.id === emp.memberId)).toMatchObject({ amount: 50_000, achieved: 40_000, percent: 80, wonDeals: 1 });
    // A member sees the company line and their own
    const mine = (await http().get("/v1/targets").set(emp.auth).expect(200)).body as TargetsDto;
    expect(mine.rows.map((r) => r.member?.id ?? null)).toEqual([null, emp.memberId]);
    expect(mine.canManage).toBe(false);
  });

  it("automation v2: invoice paid → deal won; quiet customers get a task once; email on accepted quotes; unanswered conversations", async () => {
    const owner = await signup(app);
    const p = await pipeline(owner);
    const won = p.stages.find((s) => s.kind === "won")!;
    const rule = (body: object) => http().post("/v1/automations").set(owner.auth).send(body);
    await rule({ name: "Lost", trigger: "invoice.paid", actions: [{ type: "move_stage", stageId: p.stages.find((s) => s.kind === "lost")!.id }] }).expect(400);
    await rule({ name: "Ödənildi → qazanıldı", trigger: "invoice.paid", actions: [{ type: "move_stage", stageId: won.id }] }).expect(201);
    await rule({ name: "Səssiz müştəri", trigger: "contact.inactive", conditions: { inactiveDays: 10 }, actions: [{ type: "create_task", title: "Zəng et: {title}", dueInDays: 1, assignee: "owner" }] }).expect(201);
    await rule({ name: "Təşəkkür", trigger: "quote.accepted", actions: [{ type: "send_email", subject: "Təşəkkürlər, {name}", body: "{title} qəbul edildi." }] }).expect(201);
    await rule({ name: "Cavabsız", trigger: "conversation.unanswered", actions: [{ type: "notify", recipient: "managers", message: "Cavab gözləyir: {title}" }] }).expect(201);
    const runner = app.get(AutomationRunner);

    const c = await contact(owner, { name: "Avtomat müştəri", email: "auto@example.az" });
    const deal = (await http().post("/v1/deals").set(owner.auth).send({ title: "Avtomat satış", amount: 100, contactId: c.id }).expect(201)).body as DealDto;
    await paidInvoice(owner, { contactId: c.id, dealId: deal.id, lines: [{ name: "Xidmət", quantity: 1, unit: "ədəd", unitPrice: 10_000 }] });
    await runner.drain();
    expect(((await http().get(`/v1/deals/${deal.id}`).set(owner.auth)).body as DealDto).stageId).toBe(won.id);
    expect(((await http().get(`/v1/contacts/${c.id}`).set(owner.auth)).body as ContactDto).stage).toBe("CUSTOMER");

    // Quote accepted → email to the customer (queued; sent when SMTP is configured)
    const q = (await http().post("/v1/docs").set(owner.auth).send({ kind: "quote", contactId: c.id, currency: "AZN", lines: [{ name: "X", quantity: 1, unit: "ədəd", unitPrice: 100 }] }).expect(201)).body as DocDto;
    await http().post(`/v1/docs/${q.id}/send`).set(owner.auth).send({ email: false }).expect(200);
    await http().post(`/v1/docs/${q.id}/respond`).set(owner.auth).send({ decision: "accept" }).expect(200);
    await runner.drain();
    const mails = await withRawDb((db) => db.emailMessage.find({ to: "auto@example.az" }));
    expect(mails.map((m) => m.subject)).toContain("Təşəkkürlər, Avtomat müştəri");

    // Quiet for 20 days → one task, not again until the customer is active and quiet again
    const quiet = await contact(owner, { name: "Səssiz Kamal" });
    await withRawDb((db) => db.contact.update({ id: quiet.id }, { $set: { lastActivityAt: new Date(Date.now() - 20 * DAY) } }));
    const signals = app.get(Signals);
    await signals.run();
    await runner.drain();
    await signals.run();
    await runner.drain();
    const tasks = (await http().get("/v1/tasks?view=all").set(owner.auth)).body as { title: string }[];
    expect(tasks.filter((t) => t.title === "Zəng et: Səssiz Kamal")).toHaveLength(1);

    // A customer waiting past the SLA → managers are told
    const ch = (await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "WHATSAPP", name: "Demo", demo: true }).expect(201)).body as { id: string };
    await http().post(`/v1/inbox/channels/${ch.id}/simulate`).set(owner.auth).send({ from: "+994507770000", body: "Salam?" }).expect(201);
    await withRawDb((db) => db.conversation.updateMany({ channelId: ch.id }, { $set: { awaitingSince: new Date(Date.now() - 5 * 3_600_000) } }));
    await signals.run();
    await runner.drain();
    expect((await notes(owner)).some((n) => n.type === "automation" && n.payload.title?.startsWith("Cavab gözləyir"))).toBe(true);
  });

  it("lead score: reasons and level, list filters by level and passive customers", async () => {
    const owner = await signup(app);
    const hot = await contact(owner, { name: "İsti lead", email: "isti@example.az" });
    await http().post("/v1/deals").set(owner.auth).send({ title: "Böyük layihə", amount: 900_000, contactId: hot.id }).expect(201);
    const cold = await contact(owner, { name: "Soyuq lead" });
    await withRawDb((db) => db.contact.update({ id: cold.id }, { $set: { lastActivityAt: new Date(Date.now() - 90 * DAY) } }));
    await app.get(Signals).score();

    const h = (await http().get(`/v1/contacts/${hot.id}`).set(owner.auth)).body as ContactDto;
    expect(h.scoreLevel).toBe("hot");
    expect(h.scoreReasons).toEqual(expect.arrayContaining(["reachable", "active_3d", "open_deal", "big_deal"]));
    const s = (await http().get(`/v1/contacts/${cold.id}`).set(owner.auth)).body as ContactDto;
    expect(s).toMatchObject({ scoreLevel: "cold", score: 0 });
    expect(((await http().get("/v1/contacts?level=hot").set(owner.auth)).body.items as ContactDto[]).map((x) => x.id)).toEqual([hot.id]);
    expect(((await http().get("/v1/contacts?activity=passive").set(owner.auth)).body.items as ContactDto[]).map((x) => x.id)).toEqual([cold.id]);
  });
});
