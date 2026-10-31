import type { CampaignDto, CampaignPreviewDto, ContactDto, DocDto, PortalDto, PublicDocDto, WebFormDto } from "@/shared";
import request from "supertest";
import { AutomationRunner } from "@/server/automations/automation.runner";
import { unsubscribeToken } from "@/server/growth/campaigns.service";
import { addMember, createApp, signup, withRawDb, type TestApp } from "./helpers";

describe("Website forms, email campaigns, customer portal", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  type Who = { auth: { authorization: string } };
  const contact = async (who: Who, body: object) => (await http().post("/v1/contacts").set(who.auth).send(body).expect(201)).body as ContactDto;
  const form = {
    name: "Saytdan sorğu",
    title: "Bizimlə əlaqə",
    fields: [
      { key: "name", label: "Ad", required: true },
      { key: "phone", label: "Telefon", required: true },
      { key: "email", label: "Email", required: false },
      { key: "message", label: "Mesaj", required: false },
    ],
    successMessage: "Təşəkkürlər! Tezliklə zəng edəcəyik.",
  };

  it("forms: a visitor becomes a lead with an owner in turn and a deal; repeats match the same contact; bots and inactive forms get nothing", async () => {
    const owner = await signup(app);
    const a = await addMember(app, owner, "EMPLOYEE");
    const b = await addMember(app, owner, "EMPLOYEE");
    await http().post("/v1/forms").set(a.auth).send(form).expect(403);
    await http().post("/v1/forms").set(owner.auth).send({ ...form, fields: [{ key: "name", label: "Ad", required: true }] }).expect(400);
    const f = (await http().post("/v1/forms").set(owner.auth).send({ ...form, assigneeIds: [a.memberId, b.memberId], createDeal: true }).expect(201)).body as WebFormDto;

    expect((await http().get(`/v1/public/forms/${f.key}`).expect(200)).body).toMatchObject({ title: "Bizimlə əlaqə", fields: form.fields });
    await http().post(`/v1/public/forms/${f.key}/submit`).send({ values: { name: "Ruslan" } }).expect(400);
    const ok = await http().post(`/v1/public/forms/${f.key}/submit`).send({ values: { name: "Ruslan Əliyev", phone: "+994 50 123 45 67", message: "Qiymət?" }, page: "https://site.az/qiymet" }).expect(200);
    expect(ok.body.message).toBe(form.successMessage);
    await http().post(`/v1/public/forms/${f.key}/submit`).send({ values: { name: "Səbinə", phone: "+994551112233" } }).expect(200);
    // Same phone again: the same contact, one more timeline entry
    await http().post(`/v1/public/forms/${f.key}/submit`).send({ values: { name: "Ruslan", phone: "+994501234567" } }).expect(200);
    // Honeypot: "accepted", nothing stored
    await http().post(`/v1/public/forms/${f.key}/submit`).send({ values: { name: "Bot", phone: "+1000" }, website: "http://spam" }).expect(200);

    const list = (await http().get("/v1/contacts?source=website").set(owner.auth)).body.items as ContactDto[];
    expect(list.map((c) => c.name).sort()).toEqual(["Ruslan Əliyev", "Səbinə"]);
    expect(new Set(list.map((c) => c.owner?.id))).toEqual(new Set([a.memberId, b.memberId]));
    const ruslan = list.find((c) => c.name === "Ruslan Əliyev")!;
    const timeline = (await http().get(`/v1/contacts/${ruslan.id}/activities`).set(owner.auth)).body as { type: string; payload: { values: Record<string, string> } }[];
    expect(timeline.filter((x) => x.type === "form_submitted")).toHaveLength(2);
    expect(timeline.find((x) => x.type === "form_submitted")!.payload.values).toBeDefined();
    const deals = await withRawDb((db) => db.deal.find({ contactId: { $in: list.map((c) => c.id) } }));
    expect(deals.map((d) => d.title).sort()).toEqual(["Saytdan sorğu: Ruslan Əliyev", "Saytdan sorğu: Səbinə"]);
    expect(((await http().get("/v1/forms").set(owner.auth)).body as WebFormDto[])[0]!.submissions).toBe(3);

    await http().patch(`/v1/forms/${f.id}`).set(owner.auth).send({ ...form, active: false }).expect(200);
    await http().get(`/v1/public/forms/${f.key}`).expect(404);
    await http().post(`/v1/public/forms/${f.key}/submit`).send({ values: { name: "X", phone: "+9941" } }).expect(404);
  });

  it("campaigns: preview the segment, send once, unsubscribe link, results", async () => {
    const owner = await signup(app);
    await contact(owner, { name: "Abunəçi 1", email: "a1@example.az", tags: ["vip"] });
    const c2 = await contact(owner, { name: "Abunəçi 2", email: "a2@example.az", tags: ["vip"] });
    await contact(owner, { name: "Emailsiz", tags: ["vip"] });
    await contact(owner, { name: "Başqa", email: "x@example.az" });

    expect((await http().post("/v1/campaigns/preview").set(owner.auth).send({ tag: "vip" }).expect(200)).body as CampaignPreviewDto).toMatchObject({ recipients: 2, excluded: 1 });
    const camp = (await http().post("/v1/campaigns").set(owner.auth).send({ name: "Yeni il", subject: "Salam, {name}", body: "Endirim var, {name}!", segment: { tag: "vip" } }).expect(201)).body as CampaignDto;
    const sent = (await http().post(`/v1/campaigns/${camp.id}/send`).set(owner.auth).expect(200)).body as CampaignDto;
    expect(sent).toMatchObject({ status: "sent", stats: { recipients: 2 } });
    await http().post(`/v1/campaigns/${camp.id}/send`).set(owner.auth).expect(409);
    await http().patch(`/v1/campaigns/${camp.id}`).set(owner.auth).send({ name: "xx", subject: "xx", body: "xx" }).expect(409);
    const mails = await withRawDb((db) => db.emailMessage.find({ campaignId: camp.id }));
    expect(mails.map((m) => m.subject).sort()).toEqual(["Salam, Abunəçi 1", "Salam, Abunəçi 2"]);
    expect(mails[0]!.text).toContain("/u/");

    // The customer unsubscribes: excluded next time
    const me = (await http().get("/v1/me").set(owner.auth)).body.tenant.id as string;
    await http().post(`/v1/public/unsubscribe/${unsubscribeToken(me, c2.id)}`).expect(204);
    await http().post(`/v1/public/unsubscribe/${me}.${c2.id}.forged`).expect(404);
    expect((await http().post("/v1/campaigns/preview").set(owner.auth).send({ tag: "vip" })).body.recipients).toBe(1);
    expect(((await http().get(`/v1/campaigns/${camp.id}`).set(owner.auth)).body as CampaignDto).stats.unsubscribed).toBe(1);
    // Employees don't send campaigns
    const emp = await addMember(app, owner, "EMPLOYEE");
    await http().get("/v1/campaigns").set(emp.auth).expect(403);
  });

  it("portal: the customer sees their documents and orders, answers a quote, opens a request, sends a file; a new link replaces the old", async () => {
    const owner = await signup(app);
    const c = await contact(owner, { name: "Portal müştərisi", email: "portal@example.az" });
    const other = await contact(owner, { name: "Başqa müştəri" });
    const q = (await http().post("/v1/docs").set(owner.auth).send({ kind: "quote", contactId: c.id, currency: "AZN", lines: [{ name: "Pəncərə", quantity: 1, unit: "ədəd", unitPrice: 50_000 }] }).expect(201)).body as DocDto;
    const draft = (await http().post("/v1/docs").set(owner.auth).send({ kind: "quote", contactId: c.id, currency: "AZN", lines: [{ name: "Qaralama", quantity: 1, unit: "ədəd", unitPrice: 1 }] }).expect(201)).body as DocDto;
    const foreign = (await http().post("/v1/docs").set(owner.auth).send({ kind: "quote", contactId: other.id, currency: "AZN", lines: [{ name: "Yad", quantity: 1, unit: "ədəd", unitPrice: 1 }] }).expect(201)).body as DocDto;
    await http().post(`/v1/docs/${q.id}/send`).set(owner.auth).send({ email: false }).expect(200);
    await http().post(`/v1/docs/${foreign.id}/send`).set(owner.auth).send({ email: false }).expect(200);

    const link = (await http().post(`/v1/contacts/${c.id}/portal`).set(owner.auth).send({ email: true }).expect(201)).body as { path: string; emailed: boolean };
    expect(link.path).toMatch(/^\/c\//);
    const token = link.path.replace("/c/", "");
    const view = (await http().get(`/v1/public/portal/${token}`).expect(200)).body as PortalDto;
    expect(view.customer.name).toBe("Portal müştərisi");
    expect(view.docs.map((d) => d.id)).toEqual([q.id]);
    await http().get(`/v1/public/portal/${token}/docs/${draft.id}`).expect(404);
    await http().get(`/v1/public/portal/${token}/docs/${foreign.id}`).expect(404);
    const doc = (await http().post(`/v1/public/portal/${token}/docs/${q.id}/respond`).send({ decision: "accept", name: "Portal müştərisi" }).expect(200)).body as PublicDocDto;
    expect(doc.status).toBe("accepted");
    await app.get(AutomationRunner).drain();

    const afterCase = (await http().post(`/v1/public/portal/${token}/cases`).send({ subject: "Quraşdırma vaxtı?", description: "Nə vaxt gələcəksiniz?" }).expect(201)).body as PortalDto;
    expect(afterCase.cases.map((x) => x.subject)).toEqual(["Quraşdırma vaxtı?"]);
    const withFile = (await http().post(`/v1/public/portal/${token}/files`).attach("file", Buffer.from("plan"), "plan.pdf").expect(201)).body as PortalDto;
    expect(withFile.files.map((f) => f.name)).toEqual(["plan.pdf"]);
    // Staff see the file on the contact and the request in cases
    expect(((await http().get(`/v1/contacts/${c.id}/files`).set(owner.auth)).body as { name: string }[]).map((f) => f.name)).toEqual(["plan.pdf"]);
    expect(((await http().get(`/v1/cases?contactId=${c.id}`).set(owner.auth)).body as { subject: string }[]).map((x) => x.subject)).toEqual(["Quraşdırma vaxtı?"]);

    // A new link: the old one stops working
    await http().post(`/v1/contacts/${c.id}/portal`).set(owner.auth).send({}).expect(201);
    await http().get(`/v1/public/portal/${token}`).expect(404);
    await http().get("/v1/public/portal/nonsense").expect(404);
  });
});
