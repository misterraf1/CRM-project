import type { ContactDto, DealDto, FileDto, SearchHitDto } from "@/shared";
import request from "supertest";
import { addMember, createApp, signup, type TestApp } from "./helpers";

describe("Global search, record files, @mentions, notification settings", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  type Who = { auth: { authorization: string } };
  const contact = async (who: Who, body: object) => (await http().post("/v1/contacts").set(who.auth).send(body).expect(201)).body as ContactDto;
  const search = async (who: Who, q: string) => (await http().get(`/v1/search?q=${encodeURIComponent(q)}`).set(who.auth).expect(200)).body as SearchHitDto[];
  const notes = async (who: Who) => (await http().get("/v1/notifications").set(who.auth)).body.items as { type: string; payload: Record<string, string> }[];

  it("search finds contacts, deals, tasks and documents — only what the caller may see", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const c = await contact(owner, { name: "Aysel Quliyeva", email: "aysel.q@example.az" });
    await http().post("/v1/deals").set(owner.auth).send({ title: "Aysel üçün sayt", amount: 100, contactId: c.id }).expect(201);
    await http().post("/v1/tasks").set(owner.auth).send({ title: "Aysel-ə zəng et" }).expect(201);
    const q = (await http().post("/v1/docs").set(owner.auth).send({ kind: "quote", contactId: c.id, currency: "AZN", lines: [{ name: "X", quantity: 1, unit: "ədəd", unitPrice: 1 }] }).expect(201)).body;

    const hits = await search(owner, "aysel");
    expect(hits.map((h) => h.kind).sort()).toEqual(["contact", "deal", "task"]);
    expect(hits.find((h) => h.kind === "contact")).toMatchObject({ title: "Aysel Quliyeva", subtitle: "aysel.q@example.az", href: `/crm/${c.id}` });
    expect((await search(owner, "example.az")).map((h) => h.id)).toEqual([c.id]);
    expect((await search(owner, q.number)).map((h) => [h.kind, h.subtitle])).toEqual([["quote", "Aysel Quliyeva"]]);
    // The employee sees none of the owner's records
    expect(await search(emp, "aysel")).toEqual([]);
    await http().get("/v1/search?q=a").set(owner.auth).expect(400);
  });

  it("contact and deal files: attached, listed and opened by those who see the record", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const c = await contact(owner, { name: "Fayllı müştəri" });
    const deal = (await http().post("/v1/deals").set(owner.auth).send({ title: "Fayllı satış", amount: 1, contactId: c.id }).expect(201)).body as DealDto;

    const f = (await http().post(`/v1/contacts/${c.id}/files`).set(owner.auth).attach("file", Buffer.from("müqavilə"), "muqavile.pdf").expect(201)).body as FileDto;
    await http().post(`/v1/deals/${deal.id}/files`).set(owner.auth).attach("file", Buffer.from("smeta"), "smeta.xlsx").expect(201);
    expect(((await http().get(`/v1/contacts/${c.id}/files`).set(owner.auth).expect(200)).body as FileDto[]).map((x) => x.name)).toEqual(["muqavile.pdf"]);
    expect(((await http().get(`/v1/deals/${deal.id}/files`).set(owner.auth).expect(200)).body as FileDto[]).map((x) => x.name)).toEqual(["smeta.xlsx"]);
    await http().get(`/v1/files/${f.id}`).set(owner.auth).expect(200);

    // Not visible to the employee, nor to another company
    await http().get(`/v1/contacts/${c.id}/files`).set(emp.auth).expect(404);
    await http().get(`/v1/files/${f.id}`).set(emp.auth).expect(404);
    await http().post(`/v1/contacts/${c.id}/files`).set(emp.auth).attach("file", Buffer.from("x"), "x.txt").expect(404);
    const other = await signup(app);
    await http().get(`/v1/files/${f.id}`).set(other.auth).expect(404);
    // Record files stay out of the Files section list
    expect(((await http().get("/v1/files").set(owner.auth)).body.items as { id: string }[]).some((x) => x.id === f.id)).toBe(false);

    await http().delete(`/v1/files/${f.id}`).set(owner.auth).expect(204);
    expect((await http().get(`/v1/contacts/${c.id}/files`).set(owner.auth)).body).toEqual([]);
  });

  it("@mentions notify the named colleague — only if they may see the record", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const manager = await addMember(app, owner, "MANAGER");
    const theirs = await contact(owner, { name: "Gizli müştəri" });
    const shared = await contact(emp, { name: "Ortaq müştəri" });

    await http().post(`/v1/contacts/${theirs.id}/notes`).set(owner.auth).send({ body: "@Test EMPLOYEE bax buna" }).expect(201);
    expect((await notes(emp)).filter((n) => n.type === "mention")).toEqual([]);

    await http().post(`/v1/contacts/${shared.id}/notes`).set(owner.auth).send({ body: "@test employee, sabah zəng et. @Test MANAGER də bilsin" }).expect(201);
    const m = (await notes(emp)).find((n) => n.type === "mention");
    expect(m?.payload).toMatchObject({ title: "Ortaq müştəri", actorName: "Test Sahib", contactId: shared.id });
    // The manager (no department) can't see the employee's contact: not told
    expect((await notes(manager)).filter((n) => n.type === "mention")).toEqual([]);

    // Task comments: the mention replaces the ordinary comment notice
    const task = (await http().post("/v1/tasks").set(owner.auth).send({ title: "Hesabat", assigneeId: emp.memberId }).expect(201)).body;
    await http().post(`/v1/tasks/${task.id}/comments`).set(owner.auth).send({ body: "@Test EMPLOYEE yoxla" }).expect(201);
    const types = (await notes(emp)).map((n) => n.type);
    expect(types.filter((t) => t === "mention")).toHaveLength(2);
    expect(types).not.toContain("task_comment");
  });

  it("members turn notification types off for themselves; billing notices can't be turned off", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    expect((await http().get("/v1/members/me/notifications").set(emp.auth).expect(200)).body).toEqual({ muted: [] });
    await http().patch("/v1/members/me/notifications").set(emp.auth).send({ muted: ["billing_paid"] }).expect(400);
    expect((await http().patch("/v1/members/me/notifications").set(emp.auth).send({ muted: ["task_assigned", "task_assigned"] }).expect(200)).body).toEqual({ muted: ["task_assigned"] });

    await http().post("/v1/tasks").set(owner.auth).send({ title: "Səssiz", assigneeId: emp.memberId }).expect(201);
    expect((await notes(emp)).map((n) => n.type)).not.toContain("task_assigned");
    await http().patch("/v1/members/me/notifications").set(emp.auth).send({ muted: [] }).expect(200);
    await http().post("/v1/tasks").set(owner.auth).send({ title: "Səsli", assigneeId: emp.memberId }).expect(201);
    expect((await notes(emp)).map((n) => n.type)).toContain("task_assigned");
  });
});
