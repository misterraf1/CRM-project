import type { INestApplication } from "@nestjs/common";
import type { AutomationRuleDto, AutomationRunDto, ChannelDto, ContactDto, DealDto, PipelineDto, TaskDto } from "@axis/shared";
import request from "supertest";
import { AutomationRunner } from "../src/automations/automation.runner";
import { OverdueJob } from "../src/tasks/overdue.job";
import { addMember, createApp, setPlan, signup, withRawDb, type Company } from "./helpers";

describe("Automations", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const drain = () => app.get(AutomationRunner).drain();

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const tenantOf = async (who: Company) => (await http().get("/v1/me").set(who.auth)).body.tenant.id as string;
  const me = async (who: { auth: Record<string, string> }) => (await http().get("/v1/me").set(who.auth)).body.membership.id as string;
  const rule = (who: Company, body: Record<string, unknown>) => http().post("/v1/automations").set(who.auth).send(body);
  const contact = async (who: Company, name: string, source?: string) =>
    (await http().post("/v1/contacts").set(who.auth).send({ name, ...(source ? { source } : {}) }).expect(201)).body as ContactDto;
  const notes = async (who: { auth: Record<string, string> }) =>
    (await http().get("/v1/notifications").set(who.auth).expect(200)).body.items as { type: string; payload: Record<string, string> }[];

  it("round-robin assignment of new leads that match the condition", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const ownerId = await me(owner);
    const r = (await rule(owner, {
      name: "Instagram lidləri növbə ilə",
      trigger: "contact.created",
      conditions: { source: "instagram" },
      actions: [{ type: "assign", memberIds: [ownerId, emp.memberId] }],
    }).expect(201)).body as AutomationRuleDto;

    const c1 = await contact(owner, "A", "instagram");
    const c2 = await contact(owner, "B", "instagram");
    const c3 = await contact(owner, "C", "instagram");
    const manual = await contact(owner, "D");
    expect(await drain()).toBe(4);

    const ownerOf = async (id: string) => (await http().get(`/v1/contacts/${id}`).set(owner.auth).expect(200)).body.owner?.id;
    expect([await ownerOf(c1.id), await ownerOf(c2.id), await ownerOf(c3.id)]).toEqual([ownerId, emp.memberId, ownerId]);
    expect(await ownerOf(manual.id)).toBe(ownerId);

    const list = (await http().get("/v1/automations").set(owner.auth).expect(200)).body as AutomationRuleDto[];
    expect(list[0]).toMatchObject({ id: r.id, runCount: 3, lastError: null });
    const runs = (await http().get(`/v1/automations/${r.id}/runs`).set(owner.auth).expect(200)).body as AutomationRunDto[];
    expect(runs.map((x) => x.status)).toEqual(["success", "success", "success"]);
    // Already processed events are not run again
    expect(await drain()).toBe(0);
  });

  it("won deal → follow-up task for the owner and a notification to managers", async () => {
    const owner = await signup(app);
    const manager = await addMember(app, owner, "MANAGER");
    const p = (await http().get("/v1/pipelines").set(owner.auth).expect(200)).body[0] as PipelineDto;
    const won = p.stages.find((s) => s.kind === "won")!;
    await rule(owner, {
      name: "Qazanılan sövdələşmə",
      trigger: "deal.stage_changed",
      conditions: { stageId: won.id, minAmount: 10_000 },
      actions: [
        { type: "create_task", title: "Təşəkkür zəngi: {title}", dueInDays: 1, assignee: "owner", priority: "HIGH" },
        { type: "notify", recipient: "managers", message: "Qazanıldı: {title}" },
      ],
    }).expect(201);

    const small = (await http().post("/v1/deals").set(owner.auth).send({ title: "Kiçik", amount: 5_000 }).expect(201)).body as DealDto;
    const big = (await http().post("/v1/deals").set(owner.auth).send({ title: "Böyük layihə", amount: 50_000 }).expect(201)).body as DealDto;
    await http().post(`/v1/deals/${small.id}/move`).set(owner.auth).send({ stageId: won.id }).expect(200);
    await http().post(`/v1/deals/${big.id}/move`).set(owner.auth).send({ stageId: won.id }).expect(200);
    // Moving to another open stage doesn't match the stage condition
    await http().post(`/v1/deals/${big.id}/move`).set(owner.auth).send({ stageId: p.stages[1]!.id }).expect(200);
    await drain();

    const tasks = (await http().get("/v1/tasks").set(owner.auth).expect(200)).body as TaskDto[];
    expect(tasks.filter((t) => t.title.startsWith("Təşəkkür"))).toEqual([expect.objectContaining({ title: "Təşəkkür zəngi: Böyük layihə", priority: "HIGH" })]);
    // "managers" = owners/admins + managers of the deal owner's department (this manager has none in common)
    const n = (await notes(owner)).find((x) => x.type === "automation");
    expect(n?.payload).toMatchObject({ title: "Qazanıldı: Böyük layihə", dealId: big.id, ruleName: "Qazanılan sövdələşmə" });
    expect((await notes(manager)).filter((x) => x.type === "automation")).toHaveLength(0);
  });

  it("new WhatsApp conversation → assigned; overdue task → managers notified", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    await rule(owner, { name: "WhatsApp → Nigar", trigger: "conversation.created", conditions: { channelType: "WHATSAPP" }, actions: [{ type: "assign", memberIds: [emp.memberId] }] }).expect(201);
    await rule(owner, { name: "Gecikmə xəbərdarlığı", trigger: "task.overdue", actions: [{ type: "notify", recipient: "managers", message: "Gecikir: {title}" }] }).expect(201);

    const wa = (await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "WHATSAPP", name: "WA demo", demo: true }).expect(201)).body as ChannelDto;
    const ig = (await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "INSTAGRAM", name: "IG demo", demo: true }).expect(201)).body as ChannelDto;
    const s1 = (await http().post(`/v1/inbox/channels/${wa.id}/simulate`).set(owner.auth).send({ from: "+994501112233", name: "Aysu", body: "Salam" }).expect(201)).body;
    const s2 = (await http().post(`/v1/inbox/channels/${ig.id}/simulate`).set(owner.auth).send({ from: "@ig.user", name: "IG", body: "Salam" }).expect(201)).body;

    const task = (await http().post("/v1/tasks").set(owner.auth).send({ title: "Hesabat", assigneeId: emp.memberId, dueAt: new Date(Date.now() - 3_600_000).toISOString() }).expect(201)).body as TaskDto;
    await app.get(OverdueJob).run();
    await drain();

    const conv = async (id: string) => (await http().get(`/v1/inbox/conversations/${id}`).set(owner.auth).expect(200)).body.assignee?.id ?? null;
    expect(await conv(s1.conversationId)).toBe(emp.memberId);
    expect(await conv(s2.conversationId)).toBeNull();
    const n = (await notes(owner)).find((x) => x.type === "automation");
    expect(n?.payload).toMatchObject({ title: "Gecikir: Hesabat", taskId: task.id });
  });

  it("disabled rules, deleted records and downgraded plans run nothing", async () => {
    const owner = await signup(app);
    const r = (await rule(owner, { name: "Qeyd", trigger: "contact.created", actions: [{ type: "notify", recipient: "owner", message: "Yeni: {title}" }] }).expect(201)).body as AutomationRuleDto;
    await http().patch(`/v1/automations/${r.id}`).set(owner.auth).send({ enabled: false }).expect(200);
    await contact(owner, "Söndürülüb");
    await drain();
    expect((await notes(owner)).filter((x) => x.type === "automation")).toHaveLength(0);

    await http().patch(`/v1/automations/${r.id}`).set(owner.auth).send({ enabled: true }).expect(200);
    const gone = await contact(owner, "Silinəcək");
    await http().delete(`/v1/contacts/${gone.id}`).set(owner.auth).expect(204);
    await drain();
    expect((await notes(owner)).filter((x) => x.type === "automation")).toHaveLength(0);

    // PRO has no automations: rules stay, but don't run
    const id = await tenantOf(owner);
    await setPlan(id, "PRO");
    await withRawDb((db) => db.subscription.update({ where: { tenantId: id }, data: { status: "ACTIVE" } }));
    await withRawDb((db) => db.automationEvent.create({ data: { tenantId: id, trigger: "contact.created", payload: { contactId: gone.id } } }));
    await drain();
    expect((await withRawDb((db) => db.automationRule.findUniqueOrThrow({ where: { id: r.id } }))).runCount).toBe(0);
    await http().get("/v1/automations").set(owner.auth).expect(402);
  });

  it("validation, permissions and isolation", async () => {
    const owner = await signup(app);
    const manager = await addMember(app, owner, "MANAGER");
    const other = await signup(app);
    const otherMember = await me(other);

    // Members and stages from another company are rejected
    await rule(owner, { name: "x", trigger: "contact.created", actions: [{ type: "assign", memberIds: [otherMember] }] }).expect(400);
    await rule(owner, { name: "x", trigger: "deal.created", conditions: { stageId: "nope" }, actions: [{ type: "notify", recipient: "owner", message: "hi" }] }).expect(400);
    await rule(owner, { name: "x", trigger: "contact.created", actions: [] }).expect(400);
    await rule(owner, { name: "x", trigger: "deal.won", actions: [{ type: "notify", recipient: "owner", message: "hi" }] }).expect(400);

    await http().get("/v1/automations").set(manager.auth).expect(403);
    const r = (await rule(owner, { name: "Mənim", trigger: "contact.created", actions: [{ type: "notify", recipient: "owner", message: "hi" }] }).expect(201)).body as AutomationRuleDto;
    await http().patch(`/v1/automations/${r.id}`).set(other.auth).send({ enabled: false }).expect(404);
    await http().delete(`/v1/automations/${r.id}`).set(other.auth).expect(404);
    await http().get(`/v1/automations/${r.id}/runs`).set(other.auth).expect(404);
    expect((await http().get("/v1/automations").set(other.auth).expect(200)).body).toEqual([]);
    await http().delete(`/v1/automations/${r.id}`).set(owner.auth).expect(204);
  });
});
