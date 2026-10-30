import "./channels-env";
import type { AttentionItemDto, ChannelDto, ContactDto, ConversationDetailDto, ConversationListItemDto, InboxSettings, MemberDto } from "@/shared";
import request from "supertest";
import { AutomationRunner } from "@/server/automations/automation.runner";
import { startFakeProviders } from "./fake-providers";
import { addMember, createApp, signup, withRawDb, type Company, type TestApp } from "./helpers";

const closedAllWeek = { open: false, start: "09:00", end: "18:00" };
const away = (patch: Partial<InboxSettings> = {}): InboxSettings => ({
  hours: Array(7).fill(closedAllWeek),
  autoReply: true,
  awayMessage: "Hazırda iş vaxtı deyil. Səhər 09:00-da cavab verəcəyik.",
  slaMinutes: 120,
  ...patch,
});

describe("Business hours, away reply, SLA, operator status", () => {
  let app: TestApp;
  let fake: Awaited<ReturnType<typeof startFakeProviders>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    fake = await startFakeProviders(55992);
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await fake.close();
  });

  const convs = async (who: Company) => (await http().get("/v1/inbox/conversations?status=ALL").set(who.auth).expect(200)).body as ConversationListItemDto[];
  const detail = async (who: Company, id: string) => (await http().get(`/v1/inbox/conversations/${id}`).set(who.auth).expect(200)).body as ConversationDetailDto;
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 40; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("timed out");
  };

  it("settings: defaults, managed with channel rights, an auto reply needs its message", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const defaults = (await http().get("/v1/inbox/settings").set(emp.auth).expect(200)).body as InboxSettings;
    expect(defaults).toMatchObject({ autoReply: false, slaMinutes: 120 });
    expect(defaults.hours.map((d) => d.open)).toEqual([true, true, true, true, true, false, false]);
    await http().patch("/v1/inbox/settings").set(emp.auth).send(away()).expect(403);
    await http().patch("/v1/inbox/settings").set(owner.auth).send(away({ awayMessage: null })).expect(400);
    await http().patch("/v1/inbox/settings").set(owner.auth).send(away({ hours: [{ open: true, start: "18:00", end: "09:00" }, ...Array(6).fill(closedAllWeek)] })).expect(400);
    expect((await http().patch("/v1/inbox/settings").set(owner.auth).send(away()).expect(200)).body).toEqual(away());
  });

  it("outside business hours the customer gets the away message once; the conversation keeps waiting for a person", async () => {
    const owner = await signup(app);
    await http().patch("/v1/inbox/settings").set(owner.auth).send(away()).expect(200);
    const ch = (await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "WHATSAPP", name: "Demo WA", demo: true }).expect(201)).body as ChannelDto;
    await http().post(`/v1/inbox/channels/${ch.id}/simulate`).set(owner.auth).send({ from: "+994501110000", body: "Salam" }).expect(201);
    await http().post(`/v1/inbox/channels/${ch.id}/simulate`).set(owner.auth).send({ from: "+994501110000", body: "Orada kimsə var?" }).expect(201);
    const [conv] = await convs(owner);
    expect(conv!.awaitingSince).not.toBeNull();
    const d = await detail(owner, conv!.id);
    expect(d.messages.map((m) => [m.direction, m.author, m.deliveryStatus])).toEqual([
      ["INBOUND", null, null],
      ["OUTBOUND", null, "demo"],
      ["INBOUND", null, null],
    ]);
    expect(d.messages[1]!.body).toBe(away().awayMessage);
    // Not a human answer: no first-response time
    expect(d.firstResponseMs).toBeNull();

    // Open all week: no auto reply for a new customer
    await http().patch("/v1/inbox/settings").set(owner.auth).send(away({ hours: Array(7).fill({ open: true, start: "00:00", end: "23:59" }) })).expect(200);
    await http().post(`/v1/inbox/channels/${ch.id}/simulate`).set(owner.auth).send({ from: "+994502220000", body: "Salam" }).expect(201);
    const other = (await convs(owner)).find((c) => c.id !== conv!.id)!;
    expect((await detail(owner, other.id)).messages.map((m) => m.direction)).toEqual(["INBOUND"]);
  });

  it("a real channel delivers the away message after the webhook is answered", async () => {
    const owner = await signup(app);
    await http().patch("/v1/inbox/settings").set(owner.auth).send(away()).expect(200);
    const ch = (await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "TELEGRAM", name: "Bot", botToken: "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ" }).expect(201)).body as ChannelDto;
    const secret = (fake.calls.filter((c) => c.path.endsWith("/setWebhook")).at(-1)!.body as { secret_token: string }).secret_token;
    await http()
      .post(`/v1/webhooks/telegram/${ch.id}`)
      .set("x-telegram-bot-api-secret-token", secret)
      .send({ message: { message_id: 1, chat: { id: 5151, type: "private" }, from: { id: 5151, first_name: "Gecə" }, text: "Salam" } })
      .expect(200);
    await until(async () => fake.calls.some((c) => c.path.endsWith("/sendMessage") && (c.body as { chat_id: string }).chat_id === "5151"));
    expect((fake.calls.filter((c) => c.path.endsWith("/sendMessage")).at(-1)!.body as { text: string }).text).toBe(away().awayMessage);
    const [conv] = await convs(owner);
    await until(async () => (await detail(owner, conv!.id)).messages[1]?.deliveryStatus === "sent");
    // One bot belongs to one company: free it for the other specs
    await http().delete(`/v1/inbox/channels/${ch.id}`).set(owner.auth).expect(204);
  });

  it("SLA: conversations waiting past the target are flagged and listed as needing attention", async () => {
    const owner = await signup(app);
    await http().patch("/v1/inbox/settings").set(owner.auth).send({ ...away({ autoReply: false }), slaMinutes: 15 }).expect(200);
    const ch = (await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "WHATSAPP", name: "Demo", demo: true }).expect(201)).body as ChannelDto;
    await http().post(`/v1/inbox/channels/${ch.id}/simulate`).set(owner.auth).send({ from: "+994503330000", body: "Kömək lazımdır" }).expect(201);
    let [conv] = await convs(owner);
    expect(conv!.slaBreached).toBe(false);
    await withRawDb((db) => db.conversation.update({ id: conv!.id }, { $set: { awaitingSince: new Date(Date.now() - 40 * 60_000) } }));
    [conv] = await convs(owner);
    expect(conv!.slaBreached).toBe(true);
    const items = (await http().get("/v1/dashboard/attention").set(owner.auth).expect(200)).body as AttentionItemDto[];
    expect(items.find((i) => i.reason === "unanswered")).toMatchObject({ age: 40 });
    // Answered: no longer waiting
    await http().post(`/v1/inbox/conversations/${conv!.id}/messages`).set(owner.auth).send({ body: "Buyurun" }).expect(201);
    expect((await convs(owner))[0]!.slaBreached).toBe(false);
  });

  it("operators set themselves away; automatic assignment skips them (unless everyone is away)", async () => {
    const owner = await signup(app);
    const a = await addMember(app, owner, "EMPLOYEE");
    const b = await addMember(app, owner, "EMPLOYEE");
    await http().patch("/v1/members/me/presence").set(a.auth).send({ presence: "away" }).expect(204);
    expect((await http().get("/v1/me").set(a.auth)).body.membership.presence).toBe("away");
    const list = (await http().get("/v1/members").set(owner.auth)).body as MemberDto[];
    expect(list.find((m) => m.id === a.memberId)?.presence).toBe("away");

    await http()
      .post("/v1/automations")
      .set(owner.auth)
      .send({ name: "Növbə ilə", trigger: "contact.created", actions: [{ type: "assign", memberIds: [a.memberId, b.memberId] }] })
      .expect(201);
    const make = async (name: string) => (await http().post("/v1/contacts").set(owner.auth).send({ name }).expect(201)).body as ContactDto;
    const c1 = await make("Bir");
    const c2 = await make("İki");
    await app.get(AutomationRunner).drain();
    const owners = async (ids: string[]) => Promise.all(ids.map(async (id) => ((await http().get(`/v1/contacts/${id}`).set(owner.auth)).body as ContactDto).owner?.id));
    expect(await owners([c1.id, c2.id])).toEqual([b.memberId, b.memberId]);

    await http().patch("/v1/members/me/presence").set(b.auth).send({ presence: "away" }).expect(204);
    const c3 = await make("Üç");
    await app.get(AutomationRunner).drain();
    expect((await owners([c3.id]))[0]).toEqual(expect.stringMatching(new RegExp(`^(${a.memberId}|${b.memberId})$`)));
    await http().patch("/v1/members/me/presence").set(b.auth).send({ presence: "busy" }).expect(400);
  });
});
