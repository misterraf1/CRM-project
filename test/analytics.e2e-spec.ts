import type { INestApplication } from "@nestjs/common";
import type { AnalyticsAdvancedDto, AnalyticsBasicDto, ContactDto, DealDto, PipelineDto, TaskDto } from "@axis/shared";
import request from "supertest";
import { addMember, createApp, setPlan, signup, withRawDb, type Company } from "./helpers";

describe("Analytics", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const tenantOf = async (who: Company) => (await http().get("/v1/me").set(who.auth)).body.tenant.id as string;
  const pipeline = async (who: { auth: Record<string, string> }) => (await http().get("/v1/pipelines").set(who.auth).expect(200)).body[0] as PipelineDto;
  const contact = async (who: { auth: Record<string, string> }, name: string, source?: string) =>
    (await http().post("/v1/contacts").set(who.auth).send({ name, ...(source ? { source } : {}) }).expect(201)).body as ContactDto;
  const deal = async (who: { auth: Record<string, string> }, title: string, amount: number, contactId?: string) =>
    (await http().post("/v1/deals").set(who.auth).send({ title, amount, ...(contactId ? { contactId } : {}) }).expect(201)).body as DealDto;
  const paidPlan = async (who: Company, plan: "START" | "PRO" | "BUSINESS") => {
    const id = await tenantOf(who);
    await setPlan(id, plan);
    await withRawDb((db) => db.subscription.update({ where: { tenantId: id }, data: { status: "ACTIVE" } }));
  };

  /** 3 contacts, 3 deals: one won (from Instagram), one lost, one open; one task done. */
  async function seeded() {
    const owner = await signup(app, "Analitika MMC");
    const p = await pipeline(owner);
    const won = p.stages.find((s) => s.kind === "won")!;
    const lost = p.stages.find((s) => s.kind === "lost")!;
    const ig = await contact(owner, "Leyla", "instagram");
    await contact(owner, "Nərmin", "instagram");
    await contact(owner, "Elçin");
    const d1 = await deal(owner, "Veb sayt", 500_000, ig.id);
    const d2 = await deal(owner, "Mobil tətbiq", 900_000);
    await deal(owner, "=HYPERLINK(\"http://x\")", 100_000);
    await http().post(`/v1/deals/${d1.id}/move`).set(owner.auth).send({ stageId: won.id }).expect(200);
    await http().post(`/v1/deals/${d2.id}/move`).set(owner.auth).send({ stageId: lost.id, lostReason: "Qiymət" }).expect(200);
    const t = (await http().post("/v1/tasks").set(owner.auth).send({ title: "Zəng", dueAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)).body as TaskDto;
    await http().patch(`/v1/tasks/${t.id}`).set(owner.auth).send({ status: "DONE" }).expect(200);
    return owner;
  }

  it("basic: win rate, funnel, lost reasons, lead sources, tasks", async () => {
    const owner = await seeded();
    const a = (await http().get("/v1/analytics/basic").query({ period: "30d" }).set(owner.auth).expect(200)).body as AnalyticsBasicDto;
    expect(a.scope).toBe("all");
    expect(a.sales).toMatchObject({ created: 3, won: 1, lost: 1, stillOpen: 1, winRate: 0.5, wonAmount: 500_000, avgDealSize: 500_000 });
    expect(a.sales.avgCycleDays).toBeGreaterThanOrEqual(0);
    expect(a.lostReasons).toEqual([{ reason: "Qiymət", deals: 1, amount: 900_000 }]);
    expect(a.sources.find((s) => s.source === "instagram")).toEqual({ source: "instagram", contacts: 2, customers: 1, wonDeals: 1, wonAmount: 500_000 });
    expect(a.funnel.find((s) => s.kind === "won")).toMatchObject({ deals: 1, amount: 500_000 });
    expect(a.funnel.reduce((n, s) => n + s.deals, 0)).toBe(3);
    expect(a.tasks).toMatchObject({ created: 1, completed: 1, completedOnTime: 1, overdueOpen: 0 });

    // Another company sees none of it
    const other = await signup(app);
    const b = (await http().get("/v1/analytics/basic").set(other.auth).expect(200)).body as AnalyticsBasicDto;
    expect(b.sales.created).toBe(0);
    await http().get("/v1/analytics/basic").query({ period: "7d" }).set(owner.auth).expect(400);
  });

  it("advanced: per-member performance and a 12-month trend", async () => {
    const owner = await seeded();
    const a = (await http().get("/v1/analytics/advanced").query({ period: "90d" }).set(owner.auth).expect(200)).body as AnalyticsAdvancedDto;
    const me = a.members[0]!;
    expect(me).toMatchObject({ dealsCreated: 3, dealsWon: 1, dealsLost: 1, winRate: 0.5, revenue: 500_000, tasksDone: 1, onTimeRate: 1 });
    expect(a.months).toHaveLength(12);
    expect(a.months.at(-1)).toMatchObject({ newContacts: 3, dealsWon: 1, revenue: 500_000 });
  });

  it("CSV export: deals with a BOM, formulas neutralised; needs deals.export", async () => {
    const owner = await seeded();
    const res = await http().get("/v1/analytics/export/deals.csv").query({ period: "30d" }).set(owner.auth).expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("deals.csv");
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.trim().split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('"title"');
    expect(text).toContain('"Veb sayt","5000.00","AZN"');
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);

    const manager = await addMember(app, owner, "MANAGER");
    await http().get("/v1/analytics/export/deals.csv").set(manager.auth).expect(403);
  });

  it("permissions and plans: managers yes, employees no; PRO = basic only, START = none", async () => {
    const owner = await signup(app);
    const manager = await addMember(app, owner, "MANAGER");
    const employee = await addMember(app, owner, "EMPLOYEE");
    expect((await http().get("/v1/analytics/basic").set(manager.auth).expect(200)).body.scope).toBe("department");
    await http().get("/v1/analytics/basic").set(employee.auth).expect(403);

    await paidPlan(owner, "PRO");
    await http().get("/v1/analytics/basic").set(owner.auth).expect(200);
    const gated = await http().get("/v1/analytics/advanced").set(owner.auth).expect(402);
    expect(gated.body.error).toMatchObject({ code: "FEATURE_NOT_IN_PLAN", details: { feature: "analytics.advanced" } });
    await paidPlan(owner, "START");
    await http().get("/v1/analytics/basic").set(owner.auth).expect(402);
    await paidPlan(owner, "BUSINESS");
    await http().get("/v1/analytics/advanced").set(owner.auth).expect(200);
  });
});
