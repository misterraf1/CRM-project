import "./channels-env";
import type { ChannelDto, ConversationDetailDto, ConversationListItemDto, MessageDto } from "@/shared";
import { createHmac } from "node:crypto";
import request from "supertest";
import { startFakeProviders } from "./fake-providers";
import { createApp, signup, withRawDb, type Company, type TestApp } from "./helpers";

const BOT_TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";
const SECRET = "test-meta-app-secret";

describe("Telegram, inbox media, WhatsApp templates and consent", () => {
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

  async function telegramChannel(owner: Company) {
    const ch = (await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "TELEGRAM", name: "Telegram bot", botToken: BOT_TOKEN }).expect(201)).body as ChannelDto;
    const hook = fake.calls.filter((c) => c.path.endsWith("/setWebhook")).at(-1)!.body as { url: string; secret_token: string };
    return { ch, secret: hook.secret_token, url: hook.url };
  }
  const tgUpdate = (channelId: string, secret: string, message: object) =>
    http().post(`/v1/webhooks/telegram/${channelId}`).set("x-telegram-bot-api-secret-token", secret).send({ update_id: 1, message });
  const from = { id: 4242, first_name: "Leyla", last_name: "Həsənova", username: "leyla_h" };
  const chat = { id: 4242, type: "private" };

  it("Telegram: connected with a checked token, deliveries need the secret, messages and photos arrive, replies go out", async () => {
    const owner = await signup(app, "Telegram MMC");
    const bad = await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "TELEGRAM", name: "Bad", botToken: "000000000:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ" });
    expect(bad.body.error.code).toBe("CHANNEL_ERROR");
    expect((await http().get("/v1/inbox/channels").set(owner.auth)).body).toEqual([]);

    const { ch, secret, url } = await telegramChannel(owner);
    expect(ch).toMatchObject({ type: "TELEGRAM", externalId: "777000111", botUsername: "axis_test_bot", demo: false });
    expect(url).toMatch(new RegExp(`/v1/webhooks/telegram/${ch.id}$`));
    expect(secret).toHaveLength(32);
    // The token never comes back
    expect(JSON.stringify(ch)).not.toContain(BOT_TOKEN);

    await tgUpdate(ch.id, "wrong-secret-wrong-secret-wrong-1", { message_id: 1, chat, from, date: 1_700_000_000, text: "Salam" }).expect(403);
    await tgUpdate(ch.id, secret, { message_id: 1, chat, from, date: 1_700_000_000, text: "Salam, qiymət?" }).expect(200, { stored: 1 });
    // Telegram retries the same update: stored once
    await tgUpdate(ch.id, secret, { message_id: 1, chat, from, date: 1_700_000_000, text: "Salam, qiymət?" }).expect(200, { stored: 0 });
    // Group chats are not customer conversations
    await tgUpdate(ch.id, secret, { message_id: 9, chat: { id: -100, type: "group" }, from, text: "spam" }).expect(200, { stored: 0 });
    await tgUpdate(ch.id, secret, { message_id: 2, chat, from, date: 1_700_000_010, caption: "Bu modeldən", photo: [{ file_id: "small", width: 90 }, { file_id: "big", width: 1280, file_size: 70 }] }).expect(200, { stored: 1 });

    const [conv] = await convs(owner);
    expect(conv).toMatchObject({ displayName: "Leyla Həsənova", channel: { type: "TELEGRAM" } });
    let d = await detail(owner, conv!.id);
    expect(d.canSendFiles).toBe(true);
    const photo = d.messages[1]!;
    expect(photo).toMatchObject({ direction: "INBOUND", body: "Bu modeldən", attachments: [{ name: "photo_2.jpg", mimeType: "image/jpeg", fileId: expect.any(String) }] });
    // The biggest size was downloaded; the file opens for whoever sees the conversation
    expect(fake.calls.some((c) => c.path.endsWith("/getFile") && (c.body as { file_id: string }).file_id === "big")).toBe(true);
    const file = await http().get(`/v1/files/${photo.attachments[0]!.fileId}`).set(owner.auth).buffer(true).expect(200);
    expect(file.body.subarray(1, 4).toString()).toBe("PNG");
    const other = await signup(app);
    await http().get(`/v1/files/${photo.attachments[0]!.fileId}`).set(other.auth).expect(404);

    // Text reply → sendMessage; file reply → sendPhoto with the file
    await http().post(`/v1/inbox/conversations/${conv!.id}/messages`).set(owner.auth).send({ body: "Salam! 45 AZN." }).expect(201);
    expect(fake.calls.filter((c) => c.path.endsWith("/sendMessage")).at(-1)!.body).toEqual({ chat_id: "4242", text: "Salam! 45 AZN." });
    const sent = (
      await http()
        .post(`/v1/inbox/conversations/${conv!.id}/files`)
        .set(owner.auth)
        .field("caption", "Kataloq")
        .attach("file", Buffer.from("%PDF-1.4 kataloq"), { filename: "kataloq.pdf", contentType: "application/pdf" })
        .expect(201)
    ).body as MessageDto;
    expect(sent).toMatchObject({ body: "Kataloq", deliveryStatus: "sent", attachments: [{ name: "kataloq.pdf", mimeType: "application/pdf" }] });
    const doc = fake.calls.filter((c) => c.path.endsWith("/sendDocument")).at(-1)!;
    expect(doc.contentType).toContain("multipart/form-data");
    expect(doc.body).toContain('filename="kataloq.pdf"');
    expect(doc.body).toContain("Kataloq");

    // A provider failure is recorded on the message, not lost
    fake.failNextCall();
    const failed = (await http().post(`/v1/inbox/conversations/${conv!.id}/messages`).set(owner.auth).send({ body: "Bu getməyəcək" }).expect(201)).body as MessageDto;
    expect(failed.deliveryStatus).toBe("failed");

    // STOP from the customer is recorded
    await tgUpdate(ch.id, secret, { message_id: 3, chat, from, text: "STOP" }).expect(200);
    d = await detail(owner, conv!.id);
    expect(d.optedOut).toBe(true);

    // Disconnecting tells Telegram to stop delivering
    await http().delete(`/v1/inbox/channels/${ch.id}`).set(owner.auth).expect(204);
    expect(fake.calls.at(-1)!.path).toMatch(/deleteWebhook$/);
    await tgUpdate(ch.id, secret, { message_id: 4, chat, from, text: "hələ?" }).expect(403);
    // …and the same bot can be connected again (also by another company)
    const otherCompany = await signup(app);
    const again = await telegramChannel(otherCompany);
    expect(again.ch.externalId).toBe("777000111");
    // Another company can't touch it; its owner disconnects it
    await http().delete(`/v1/inbox/channels/${again.ch.id}`).set(owner.auth).expect(404);
    await http().delete(`/v1/inbox/channels/${again.ch.id}`).set(otherCompany.auth).expect(204);
  });

  it("WhatsApp: media arrives and goes out; templates outside the 24 h window, never after an opt-out", async () => {
    const owner = await signup(app, "WA Media MMC");
    const phoneNumberId = `55${Date.now().toString().slice(-8)}`;
    const ch = (
      await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "WHATSAPP", name: "WA", phoneNumberId, accessToken: "EAAG-test-token-1234567890", wabaId: "1029384756" }).expect(201)
    ).body as ChannelDto;
    expect(ch).toMatchObject({ templates: 0, canSyncTemplates: true });
    const synced = (await http().post(`/v1/inbox/channels/${ch.id}/templates/sync`).set(owner.auth).expect(200)).body as ChannelDto;
    expect(synced.templates).toBe(1);

    const payload = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: "994551112233", profile: { name: "Rauf" } }], messages: [{ from: "994551112233", id: "wamid.img1", timestamp: "1700000000", type: "image", image: { id: "MEDIA_1", mime_type: "image/png", caption: "Ölçülər" } }] } }] }],
    };
    const raw = JSON.stringify(payload);
    await http().post("/v1/webhooks/meta").set("content-type", "application/json").set("x-hub-signature-256", `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`).send(raw).expect(200);
    const [conv] = await convs(owner);
    let d = await detail(owner, conv!.id);
    expect(d.messages[0]).toMatchObject({ body: "Ölçülər", attachments: [{ mimeType: "image/png", fileId: expect.any(String) }] });
    expect(d.templates).toEqual([{ name: "order_ready", language: "az", body: "Salam {{1}}! {{2}} sifarişiniz hazırdır.", params: 2 }]);

    // The message is old (2023): the window is closed — free text and files are refused, templates go
    await http().post(`/v1/inbox/conversations/${conv!.id}/messages`).set(owner.auth).send({ body: "Salam" }).expect(409);
    await http().post(`/v1/inbox/conversations/${conv!.id}/files`).set(owner.auth).attach("file", Buffer.from("x"), "a.txt").expect(409);
    await http().post(`/v1/inbox/conversations/${conv!.id}/template`).set(owner.auth).send({ name: "order_ready", language: "az", params: ["Rauf"] }).expect(400);
    const t = (await http().post(`/v1/inbox/conversations/${conv!.id}/template`).set(owner.auth).send({ name: "order_ready", language: "az", params: ["Rauf", "S-2026-0007"] }).expect(201)).body as MessageDto;
    expect(t).toMatchObject({ body: "Salam Rauf! S-2026-0007 sifarişiniz hazırdır.", deliveryStatus: "sent" });
    expect(fake.calls.at(-1)!.body).toMatchObject({ type: "template", template: { name: "order_ready", language: { code: "az" }, components: [{ type: "body", parameters: [{ type: "text", text: "Rauf" }, { type: "text", text: "S-2026-0007" }] }] } });

    // Inside the window a file goes: uploaded, then sent by id
    await withRawDb((db) => db.conversation.update({ id: conv!.id }, { $set: { lastInboundAt: new Date() } }));
    await http().post(`/v1/inbox/conversations/${conv!.id}/files`).set(owner.auth).attach("file", Buffer.from("PNGDATA"), { filename: "plan.png", contentType: "image/png" }).expect(201);
    const upload = fake.calls.at(-2)!;
    expect(upload.path).toBe(`/v21.0/${phoneNumberId}/media`);
    expect(fake.calls.at(-1)!.body).toMatchObject({ type: "image", image: { id: expect.stringMatching(/^media_/) } });

    // Opt-out recorded on the contact blocks templates
    const link = (await http().post(`/v1/inbox/conversations/${conv!.id}/contact`).set(owner.auth).send({}).expect(201)).body as { contactId: string };
    await http().patch(`/v1/contacts/${link.contactId}/consent`).set(owner.auth).send({ status: "opted_out" }).expect(204);
    d = await detail(owner, conv!.id);
    expect(d.optedOut).toBe(true);
    const refused = await http().post(`/v1/inbox/conversations/${conv!.id}/template`).set(owner.auth).send({ name: "order_ready", language: "az", params: ["Rauf", "1"] }).expect(409);
    expect(refused.body.error.code).toBe("CONSENT_REQUIRED");
    expect((await http().get(`/v1/contacts/${link.contactId}`).set(owner.auth)).body.messagingConsent).toMatchObject({ status: "opted_out", source: "manual" });
    await http().patch(`/v1/contacts/${link.contactId}/consent`).set(owner.auth).send({ status: "opted_in" }).expect(204);
    expect((await detail(owner, conv!.id)).optedOut).toBe(false);
  });

  it("demo channels show templates without Meta; demo Telegram needs no token", async () => {
    const owner = await signup(app);
    const demo = (await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "WHATSAPP", name: "Demo WA", demo: true }).expect(201)).body as ChannelDto;
    await http().post(`/v1/inbox/channels/${demo.id}/templates/sync`).set(owner.auth).expect(409);
    await http().post(`/v1/inbox/channels/${demo.id}/simulate`).set(owner.auth).send({ from: "+994501110000", body: "Salam" }).expect(201);
    const [conv] = await convs(owner);
    const d = await detail(owner, conv!.id);
    expect(d.templates.map((t) => t.name)).toEqual(["order_ready", "follow_up"]);
    const sent = (await http().post(`/v1/inbox/conversations/${conv!.id}/template`).set(owner.auth).send({ name: "follow_up", language: "az", params: ["Orxan"] }).expect(201)).body as MessageDto;
    expect(sent.deliveryStatus).toBe("demo");
    const tg = (await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "TELEGRAM", name: "Demo TG", demo: true }).expect(201)).body as ChannelDto;
    expect(tg.botUsername).toBeNull();
  });
});
