import type { INestApplication } from "@nestjs/common";
import type { ChannelDto, ConversationDetailDto, ConversationListItemDto } from "@axis/shared";
import { createHmac } from "node:crypto";
import request from "supertest";
import { startFakeGraph } from "./fake-graph";
import { addMember, createApp, ownerClient, signup, type Company } from "./helpers";

type Who = { auth: Record<string, string> };
const SECRET = "test-meta-app-secret";

describe("Inbox: website chat, Meta channels, routing, metrics", () => {
  let app: INestApplication;
  let graph: Awaited<ReturnType<typeof startFakeGraph>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    graph = await startFakeGraph();
  });
  afterAll(async () => {
    await graph.close();
    await app.close();
  });

  const channel = async (who: Who, body: Record<string, unknown>) =>
    (await http().post("/v1/inbox/channels").set(who.auth).send(body).expect(201)).body as ChannelDto;
  const keyOf = (c: ChannelDto) => /data-axis-widget="([^"]+)"/.exec(c.embedCode!)![1]!;
  const conversations = async (who: Who, query: Record<string, string> = {}) =>
    (await http().get("/v1/inbox/conversations").query(query).set(who.auth).expect(200)).body as ConversationListItemDto[];
  const detail = async (who: Who, id: string) => (await http().get(`/v1/inbox/conversations/${id}`).set(who.auth).expect(200)).body as ConversationDetailDto;
  const reply = (who: Who, id: string, body: string, internal = false) =>
    http().post(`/v1/inbox/conversations/${id}/messages`).set(who.auth).send({ body, internal });

  const signed = (payload: unknown) => {
    const raw = JSON.stringify(payload);
    return { raw, sig: `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` };
  };
  const deliver = (payload: unknown, sig?: string) => {
    const s = signed(payload);
    return http().post("/v1/webhooks/meta").set("content-type", "application/json").set("x-hub-signature-256", sig ?? s.sig).send(s.raw);
  };
  const waText = (phoneNumberId: string, from: string, id: string, body: string, name = "Orxan") => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "994501112233", phone_number_id: phoneNumberId },
              contacts: [{ wa_id: from, profile: { name } }],
              messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  });

  describe("website chat", () => {
    it("visitor writes → agent sees it → reply and internal note → visitor sees only the reply", async () => {
      const owner = await signup(app, "Sayt MMC");
      const web = await channel(owner, { type: "WEBCHAT", name: "Sayt", greeting: "Salam! Necə kömək edək?" });
      expect(web.embedCode).toMatch(/<script src="http:\/\/localhost:3000\/widget\.js" data-axis-widget="[^"]+" async><\/script>/);
      const key = keyOf(web);

      const cfg = await http().get(`/v1/widget/${key}/config`).expect(200);
      expect(cfg.body).toEqual({ companyName: "Sayt MMC", channelName: "Sayt", greeting: "Salam! Necə kömək edək?" });

      const first = await http().post(`/v1/widget/${key}/messages`).send({ body: "Qiymət nə qədərdir?", name: "Leyla", email: "leyla@example.az" }).expect(201);
      const token = first.body.visitorToken as string;
      await http().post(`/v1/widget/${key}/messages`).send({ visitorToken: token, body: "Cavab gözləyirəm" }).expect(201);

      const [c] = await conversations(owner);
      expect(c).toMatchObject({ displayName: "Leyla", handle: "leyla@example.az", unreadCount: 2, status: "OPEN", assignee: null });
      expect(c!.awaitingSince).not.toBeNull();
      expect(c!.channel).toMatchObject({ type: "WEBCHAT", demo: false });

      await reply(owner, c!.id, "Daxili: endirim verək?", true).expect(201);
      const sent = await reply(owner, c!.id, "Salam Leyla, 49 ₼-dır.").expect(201);
      expect(sent.body).toMatchObject({ direction: "OUTBOUND", deliveryStatus: "sent" });

      const d = await detail(owner, c!.id);
      expect(d.messages.map((m) => m.direction)).toEqual(["INBOUND", "INBOUND", "INTERNAL_NOTE", "OUTBOUND"]);
      expect(d).toMatchObject({ unreadCount: 0, awaitingSince: null, assignee: { name: "Test Sahib" } });
      expect(d.firstResponseMs).toBeGreaterThanOrEqual(0);

      // The visitor never sees internal notes
      const seen = await http().get(`/v1/widget/${key}/messages`).query({ visitorToken: token }).expect(200);
      expect(seen.body.map((m: { from: string; body: string }) => `${m.from}:${m.body}`)).toEqual([
        "visitor:Qiymət nə qədərdir?",
        "visitor:Cavab gözləyirəm",
        "agent:Salam Leyla, 49 ₼-dır.",
      ]);
      expect(seen.body[2].authorName).toBe("Test");
      const after = await http().get(`/v1/widget/${key}/messages`).query({ visitorToken: token, after: seen.body[1].createdAt }).expect(200);
      expect(after.body).toHaveLength(1);

      // Another visitor (different token) sees nothing of this conversation
      const stranger = await http().get(`/v1/widget/${key}/messages`).query({ visitorToken: "x".repeat(32) }).expect(200);
      expect(stranger.body).toEqual([]);

      // Customer writes again after "resolved" → conversation reopens
      await http().patch(`/v1/inbox/conversations/${c!.id}`).set(owner.auth).send({ status: "RESOLVED" }).expect(200);
      expect(await conversations(owner)).toHaveLength(0);
      await http().post(`/v1/widget/${key}/messages`).send({ visitorToken: token, body: "Bir sualım da var" }).expect(201);
      expect((await conversations(owner))[0]).toMatchObject({ id: c!.id, status: "OPEN" });
    });

    it("widget keys can't cross tenants or reach non-webchat channels", async () => {
      const a = await signup(app);
      const b = await signup(app);
      const webA = await channel(a, { type: "WEBCHAT", name: "A" });
      const demoB = await channel(b, { type: "WHATSAPP", name: "B demo", demo: true });
      const meB = (await http().get("/v1/me").set(b.auth)).body;
      // B's tenant id with A's channel id
      await http().get(`/v1/widget/${meB.tenant.id}.${webA.id}/config`).expect(404);
      await http().post(`/v1/widget/${meB.tenant.id}.${demoB.id}/messages`).send({ body: "x" }).expect(404);
      await http().get(`/v1/widget/garbage/config`).expect(404);
      expect(await conversations(a)).toHaveLength(0);
    });
  });

  describe("WhatsApp Cloud API (against a fake Graph server)", () => {
    async function liveWhatsApp(owner: Company) {
      const phoneNumberId = String(100000 + Math.floor(Math.random() * 1e9));
      const ch = await channel(owner, { type: "WHATSAPP", name: "WhatsApp", phoneNumberId, accessToken: "EAAG-test-access-token-123456" });
      return { ch, phoneNumberId };
    }

    it("stores the access token encrypted and never returns it", async () => {
      const owner = await signup(app);
      const { ch } = await liveWhatsApp(owner);
      expect(JSON.stringify(ch)).not.toContain("EAAG");
      const db = await ownerClient();
      const { rows } = await db.query(`SELECT credentials FROM "Channel" WHERE id = $1`, [ch.id]);
      await db.end();
      expect(rows[0].credentials.toString("latin1")).not.toContain("EAAG");
      // Live channels need credentials
      await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "WHATSAPP", name: "x" }).expect(400);
    });

    it("signature check, ingestion, contact matching, idempotent retries", async () => {
      const owner = await signup(app);
      const { phoneNumberId } = await liveWhatsApp(owner);
      await http().post("/v1/contacts").set(owner.auth).send({ name: "Orxan Səfərov", phone: "+994 50 123 45 67" }).expect(201);
      const payload = waText(phoneNumberId, "994501234567", "wamid.IN1", "Salam, sifarişim haradadır?");

      await deliver(payload, "sha256=deadbeef").expect(403);
      await http().post("/v1/webhooks/meta").set("content-type", "application/json").send(JSON.stringify(payload)).expect(403);

      const ok = await deliver(payload).expect(200);
      expect(ok.body).toEqual({ duplicate: false, stored: 1 });
      expect((await deliver(payload).expect(200)).body).toEqual({ duplicate: true, stored: 0 });
      // Same message id in a different delivery body is still stored once
      const again = waText(phoneNumberId, "994501234567", "wamid.IN1", "Salam, sifarişim haradadır?", "Orxan S.");
      expect((await deliver(again).expect(200)).body).toEqual({ duplicate: false, stored: 0 });

      const [c] = await conversations(owner);
      // Matched to the existing CRM contact by phone number
      expect(c).toMatchObject({ displayName: "Orxan Səfərov", handle: "+994501234567", unreadCount: 1 });
      expect(c!.contact?.name).toBe("Orxan Səfərov");
    });

    it("replies go to the Graph API; receipts update status; errors are recorded, not swallowed", async () => {
      const owner = await signup(app);
      const { phoneNumberId } = await liveWhatsApp(owner);
      await deliver(waText(phoneNumberId, "994551112233", `wamid.${Date.now()}`, "Salam")).expect(200);
      const [c] = await conversations(owner);

      const before = graph.calls.length;
      const sent = await reply(owner, c!.id, "Salam! Sifarişiniz yoldadır.").expect(201);
      expect(sent.body.deliveryStatus).toBe("sent");
      const call = graph.calls[before]!;
      expect(call.path).toBe(`/v21.0/${phoneNumberId}/messages`);
      expect(call.authorization).toBe("Bearer EAAG-test-access-token-123456");
      expect(call.body).toEqual({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "994551112233",
        type: "text",
        text: { preview_url: false, body: "Salam! Sifarişiniz yoldadır." },
      });

      // Internal notes never reach the provider
      await reply(owner, c!.id, "qeyd", true).expect(201);
      expect(graph.calls.length).toBe(before + 1);

      // Delivery receipt
      const wamid = `wamid.${before + 1}`;
      await deliver({
        object: "whatsapp_business_account",
        entry: [{ id: "waba", changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: wamid, status: "read" }] } }] }],
      }).expect(200);
      expect((await detail(owner, c!.id)).messages.find((m) => m.direction === "OUTBOUND")!.deliveryStatus).toBe("read");

      graph.failNextCall();
      const failed = await reply(owner, c!.id, "Bu getməyəcək").expect(201);
      expect(failed.body.deliveryStatus).toBe("failed");
    });

    it("free-form replies are blocked after the 24-hour window", async () => {
      const owner = await signup(app);
      const { phoneNumberId } = await liveWhatsApp(owner);
      await deliver(waText(phoneNumberId, "994701112233", `wamid.old${Date.now()}`, "Salam")).expect(200);
      const [c] = await conversations(owner);
      expect((await detail(owner, c!.id)).replyWindowEndsAt).not.toBeNull();
      const db = await ownerClient();
      await db.query(`UPDATE "Conversation" SET "lastInboundAt" = (now() AT TIME ZONE 'UTC') - interval '25 hours' WHERE id = $1`, [c!.id]);
      await db.end();
      const res = await reply(owner, c!.id, "Gecikmiş cavab").expect(409);
      expect(res.body.error.code).toBe("WINDOW_CLOSED");
      // Internal notes are still fine
      await reply(owner, c!.id, "Şablonla yazmaq lazımdır", true).expect(201);
    });

    it("handshake verifies the token", async () => {
      await http().get("/v1/webhooks/meta").query({ "hub.mode": "subscribe", "hub.verify_token": "test-verify-token", "hub.challenge": "42" }).expect(200, "42");
      await http().get("/v1/webhooks/meta").query({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42" }).expect(403);
    });
  });

  it("Messenger: page events ingested, echoes ignored, replies via /me/messages", async () => {
    const owner = await signup(app);
    const pageId = String(200000 + Math.floor(Math.random() * 1e9));
    await channel(owner, { type: "MESSENGER", name: "Facebook", accountId: pageId, accessToken: "EAAPage-token-1234567890" });
    const event = (mid: string, text: string, echo = false) => ({
      object: "page",
      entry: [{ id: pageId, time: Date.now(), messaging: [{ sender: { id: "PSID-77" }, recipient: { id: pageId }, timestamp: Date.now(), message: { mid, text, is_echo: echo } }] }],
    });
    expect((await deliver(event(`m.${Date.now()}`, "Salam, açıqsınız?")).expect(200)).body.stored).toBe(1);
    expect((await deliver(event(`m.echo${Date.now()}`, "our echo", true)).expect(200)).body.stored).toBe(0);
    const [c] = await conversations(owner);
    const before = graph.calls.length;
    await reply(owner, c!.id, "Bəli, 18:00-a qədər").expect(201);
    expect(graph.calls[before]).toMatchObject({
      path: "/v21.0/me/messages",
      authorization: "Bearer EAAPage-token-1234567890",
      body: { recipient: { id: "PSID-77" }, messaging_type: "RESPONSE", message: { text: "Bəli, 18:00-a qədər" } },
    });
  });

  it("demo channels: simulated inbound, replies never leave the system", async () => {
    const owner = await signup(app);
    const demo = await channel(owner, { type: "INSTAGRAM", name: "Instagram (demo)", demo: true });
    expect(demo.demo).toBe(true);
    const sim = await http().post(`/v1/inbox/channels/${demo.id}/simulate`).set(owner.auth).send({ from: "@gunay.b", name: "Günay", body: "Endirim var?" }).expect(201);
    const before = graph.calls.length;
    const sent = await reply(owner, sim.body.conversationId, "Bəli, 10%").expect(201);
    expect(sent.body.deliveryStatus).toBe("demo");
    expect(graph.calls.length).toBe(before);
    // Live channels don't accept simulated traffic
    const { body: live } = await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "WEBCHAT", name: "Sayt" }).expect(201);
    await http().post(`/v1/inbox/channels/${live.id}/simulate`).set(owner.auth).send({ from: "x", body: "y" }).expect(403);
  });

  it("routing and visibility: employee sees assigned only; assigning needs inbox.assign; forward to department", async () => {
    const owner = await signup(app);
    const manager = await addMember(app, owner, "MANAGER");
    const emp = await addMember(app, owner, "EMPLOYEE");
    const dept = (await http().post("/v1/departments").set(owner.auth).send({ name: "Dəstək" }).expect(201)).body;
    await http().patch(`/v1/members/${manager.memberId}`).set(owner.auth).send({ departmentId: dept.id }).expect(200);
    const demo = await channel(owner, { type: "WHATSAPP", name: "WA demo", demo: true });
    const sim = (from: string) => http().post(`/v1/inbox/channels/${demo.id}/simulate`).set(owner.auth).send({ from, body: "Salam" }).expect(201);
    const one = (await sim("+994500000001")).body.conversationId;
    const two = (await sim("+994500000002")).body.conversationId;

    expect(await conversations(emp)).toEqual([]);
    await http().get(`/v1/inbox/conversations/${one}`).set(emp.auth).expect(404);
    expect((await conversations(manager)).length).toBe(2); // unassigned are the manager's queue

    await http().patch(`/v1/inbox/conversations/${one}`).set(emp.auth).send({ assigneeId: emp.memberId }).expect(404);
    await http().patch(`/v1/inbox/conversations/${one}`).set(manager.auth).send({ assigneeId: emp.memberId }).expect(200);
    expect((await conversations(emp)).map((c) => c.id)).toEqual([one]);
    await reply(emp, one, "Salam, kömək edim").expect(201);
    // Employee can't reassign
    await http().patch(`/v1/inbox/conversations/${one}`).set(emp.auth).send({ assigneeId: manager.memberId }).expect(403);

    // Forward to department: back into the department queue, visible to its manager
    await http().patch(`/v1/inbox/conversations/${one}`).set(owner.auth).send({ departmentId: dept.id }).expect(200);
    expect(await conversations(emp)).toEqual([]);
    expect((await conversations(manager, { assignee: "unassigned" })).map((c) => c.id).sort()).toEqual([one, two].sort());
    await http().patch(`/v1/inbox/conversations/${two}`).set(owner.auth).send({ assigneeId: "mem_nope" }).expect(400);
  });

  it("add to CRM from a conversation, then find the conversation from the contact", async () => {
    const owner = await signup(app);
    const demo = await channel(owner, { type: "WHATSAPP", name: "WA demo", demo: true });
    const { body } = await http().post(`/v1/inbox/channels/${demo.id}/simulate`).set(owner.auth).send({ from: "+994 55 765 43 21", name: "Rəşad", body: "Salam" }).expect(201);
    const linked = await http().post(`/v1/inbox/conversations/${body.conversationId}/contact`).set(owner.auth).send({}).expect(201);
    const contact = (await http().get(`/v1/contacts/${linked.body.contactId}`).set(owner.auth).expect(200)).body;
    expect(contact).toMatchObject({ name: "Rəşad", phone: "+994557654321", source: "whatsapp" });
    const forContact = await conversations(owner, { contactId: contact.id, status: "ALL" });
    expect(forContact.map((c) => c.id)).toEqual([body.conversationId]);
  });

  it("canned responses: create, validate shortcut, delete; only managers", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const t = await http().post("/v1/inbox/templates").set(owner.auth).send({ shortcut: "/salam", body: "Salam! Necə kömək edə bilərik?" }).expect(201);
    await http().post("/v1/inbox/templates").set(owner.auth).send({ shortcut: "salam", body: "x" }).expect(400);
    await http().post("/v1/inbox/templates").set(owner.auth).send({ shortcut: "/salam", body: "dup" }).expect(409);
    await http().post("/v1/inbox/templates").set(emp.auth).send({ shortcut: "/x", body: "y" }).expect(403);
    expect((await http().get("/v1/inbox/templates").set(emp.auth).expect(200)).body).toHaveLength(1);
    await http().delete(`/v1/inbox/templates/${t.body.id}`).set(owner.auth).expect(204);
  });

  it("metrics and dashboard reflect real conversations", async () => {
    const owner = await signup(app);
    const web = await channel(owner, { type: "WEBCHAT", name: "Sayt" });
    const key = keyOf(web);
    await http().post(`/v1/widget/${key}/messages`).send({ body: "Birinci" }).expect(201);
    await http().post(`/v1/widget/${key}/messages`).send({ body: "İkinci", name: "Sevinc" }).expect(201);
    const list = await conversations(owner);
    const db = await ownerClient();
    await db.query(`UPDATE "Conversation" SET "createdAt" = "createdAt" - interval '10 minutes' WHERE id = $1`, [list[0]!.id]);
    await db.end();
    await reply(owner, list[0]!.id, "Cavab").expect(201);

    const m = (await http().get("/v1/inbox/metrics").set(owner.auth).expect(200)).body;
    expect(m).toMatchObject({ awaiting: 1, avgFirstResponseMin: 10, byChannel: [{ type: "WEBCHAT", conversations: 2 }] });
    expect(m.byMember[0]).toMatchObject({ conversations: 1, avgFirstResponseMin: 10 });

    expect((await http().get("/v1/me/summary").set(owner.auth)).body.awaitingConversations).toBe(1);
    const dash = (await http().get("/v1/dashboard").set(owner.auth).expect(200)).body;
    expect(dash.inbox).toMatchObject({ awaiting: 1, avgFirstResponseMin: 10 });
    expect(dash.inbox.items[0]).toMatchObject({ channel: "WEBCHAT", preview: expect.any(String) });
    expect(dash.team[0].avgResponseMin).toBe(10);
  });

  it("server-sent events notify agents of new messages", async () => {
    const owner = await signup(app);
    const web = await channel(owner, { type: "WEBCHAT", name: "Sayt" });
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/v1/inbox/stream`, { headers: owner.auth, signal: controller.signal });
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = res.body!.getReader();
    await reader.read(); // ": connected"
    await http().post(`/v1/widget/${keyOf(web)}/messages`).send({ body: "Canlı" }).expect(201);
    let text = "";
    while (!text.includes("data:")) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    const event = JSON.parse(text.slice(text.indexOf("data:") + 5).trim().split("\n")[0]!);
    expect(event).toMatchObject({ type: "message", direction: "INBOUND", conversationId: expect.any(String) });
  });
});
