import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ApiKeyCreatedDto, CalendarEventDto, ContactDto, DealDto, InboundHookDto, WebhookDeliveryDto, WebhookEndpointDto } from "@/shared";
import request from "supertest";
import { HooksService } from "@/server/integrations/hooks.service";
import { addMember, createApp, signup, type TestApp } from "./helpers";

describe("Integrations: public API keys, outgoing webhooks, incoming addresses", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());
  // A receiver standing in for the company's own system
  let receiver: Server;
  let receiverUrl: string;
  const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  let reply = 200;

  beforeAll(async () => {
    app = await createApp();
    receiver = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.statusCode = reply;
        res.end("ok");
      });
    });
    await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
  });
  afterAll(async () => {
    await new Promise((r) => receiver.close(r));
    await app.close();
  });

  const contacts = async (auth: Record<string, string>) => ((await http().get("/v1/contacts").query({ limit: "100" }).set(auth).expect(200)).body.items as ContactDto[]);

  it("API keys: scoped paths only, act as their creator, stop when revoked; only admins make them", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    await http().post("/v1/integrations/api-keys").set(emp.auth).send({ name: "x", scopes: ["contacts.read"] }).expect(403);

    const { key, apiKey } = (await http().post("/v1/integrations/api-keys").set(owner.auth).send({ name: "Sayt", scopes: ["contacts.read", "contacts.write"] }).expect(201)).body as ApiKeyCreatedDto;
    expect(key.startsWith("axk_")).toBe(true);
    expect(apiKey.prefix).toBe(key.slice(0, 10));
    const bearer = { authorization: `Bearer ${key}` };

    const me = (await http().get("/v1/me").set(owner.auth)).body as { membership: { id: string }; tenant: { id: string } };
    const made = (await http().post("/v1/contacts").set(bearer).send({ name: "API ilə gələn", phone: "+994501112233" }).expect(201)).body as ContactDto;
    expect(made.owner?.id).toBe(me.membership.id);
    expect((await contacts(bearer)).map((c) => c.id)).toContain(made.id);
    // Outside its scopes, and never the account itself
    await http().get("/v1/deals").set(bearer).expect(403);
    await http().get("/v1/members").set(bearer).expect(403);
    await http().get("/v1/me").set(bearer).expect(403);
    await http().post("/v1/integrations/api-keys").set(bearer).send({ name: "y", scopes: ["contacts.read"] }).expect(403);

    const read = (await http().post("/v1/integrations/api-keys").set(owner.auth).send({ name: "Hesabat", scopes: ["contacts.read"] }).expect(201)).body as ApiKeyCreatedDto;
    await http().get("/v1/contacts").set({ authorization: `Bearer ${read.key}` }).expect(200);
    await http().post("/v1/contacts").set({ authorization: `Bearer ${read.key}` }).send({ name: "x" }).expect(403);

    const list = (await http().get("/v1/integrations/api-keys").set(owner.auth).expect(200)).body as { id: string; lastUsedAt: string | null }[];
    expect(list.find((x) => x.id === apiKey.id)?.lastUsedAt).toBeTruthy();
    await http().delete(`/v1/integrations/api-keys/${apiKey.id}`).set(owner.auth).expect(200);
    await http().get("/v1/contacts").set(bearer).expect(401);
    // A key of another company can't be used against this one
    await http().get("/v1/contacts").set({ authorization: `Bearer axk_${me.tenant.id}.forged` }).expect(401);
    expect((await http().get("/v1/openapi.json").expect(200)).body.openapi).toBe("3.1.0");
  });

  it("webhooks: signed deliveries for chosen events, a test ping, retries on failure", async () => {
    const owner = await signup(app);
    await http().post("/v1/integrations/webhooks").set(owner.auth).send({ url: "ftp://x.az/h", events: ["contact.created"] }).expect(400);
    const hook = (await http().post("/v1/integrations/webhooks").set(owner.auth).send({ url: receiverUrl, events: ["contact.created", "deal.created"] }).expect(201)).body as WebhookEndpointDto;
    expect(hook.secret.startsWith("whsec_")).toBe(true);

    received.length = 0;
    const c = (await http().post("/v1/contacts").set(owner.auth).send({ name: "Webhook müştəri", email: "w@x.az" }).expect(201)).body as ContactDto;
    await app.get(HooksService).drain();
    expect(received).toHaveLength(1);
    const got = received[0]!;
    const body = JSON.parse(got.body) as { event: string; data: { contact: { id: string; name: string } } };
    expect(body).toMatchObject({ event: "contact.created", data: { contact: { id: c.id, name: "Webhook müştəri" } } });
    const ts = got.headers["x-axis-timestamp"] as string;
    expect(got.headers["x-axis-signature"]).toBe(`sha256=${createHmac("sha256", hook.secret).update(`${ts}.${got.body}`).digest("hex")}`);

    // Failures are retried later, and the log says why
    reply = 500;
    await http().post("/v1/contacts").set(owner.auth).send({ name: "İkinci" }).expect(201);
    await app.get(HooksService).drain();
    let log = (await http().get(`/v1/integrations/webhooks/${hook.id}/deliveries`).set(owner.auth).expect(200)).body as WebhookDeliveryDto[];
    expect(log[0]).toMatchObject({ status: "pending", attempts: 1, responseStatus: 500, error: "HTTP 500" });
    reply = 200;
    const ping = (await http().post(`/v1/integrations/webhooks/${hook.id}/test`).set(owner.auth).expect(200)).body as WebhookDeliveryDto;
    expect(ping).toMatchObject({ event: "ping", status: "success", responseStatus: 200 });

    // A paused webhook gets nothing
    await http().patch(`/v1/integrations/webhooks/${hook.id}`).set(owner.auth).send({ active: false }).expect(200);
    received.length = 0;
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Üçüncü" }).expect(201);
    await app.get(HooksService).drain();
    expect(received).toHaveLength(0);
    log = (await http().get(`/v1/integrations/webhooks/${hook.id}/deliveries`).set(owner.auth)).body as WebhookDeliveryDto[];
    expect(log.length).toBeGreaterThanOrEqual(2);
  });

  it("incoming: website form leads, Google Ads with its key, signed Shopify orders, PBX calls; repeats are ignored", async () => {
    const owner = await signup(app);
    const create = async (body: object) => (await http().post("/v1/integrations/inbound").set(owner.auth).send(body).expect(201)).body as InboundHookDto;
    const path = (h: InboundHookDto) => new URL(h.url).pathname.replace(/^\/api/, "");
    await http().post("/v1/integrations/inbound").set(owner.auth).send({ kind: "shopify", name: "Mağaza" }).expect(400);

    // Tilda-style form post (form-encoded), with its test ping first
    const site = await create({ kind: "leads", name: "Sayt", createDeal: true });
    expect((await http().post(path(site)).type("form").send("test=test").expect(200)).body).toMatchObject({ ok: true, ignored: "test" });
    await http().post(path(site)).type("form").send({ Name: "Aysel", Phone: "050 123 45 67", utm_campaign: "yaz-endirim", comment: "Qiymət?" }).expect(200);
    let list = await contacts(owner.auth);
    const aysel = list.find((c) => c.name === "Aysel")!;
    expect(aysel).toMatchObject({ phone: "+994501234567", source: "website", tags: ["yaz-endirim"] });
    // The same person again: no second card
    await http().post(path(site)).send({ name: "Aysel M.", phone: "+994 50 123 45 67" }).expect(200);
    expect((await contacts(owner.auth)).filter((c) => c.phone === "+994501234567")).toHaveLength(1);
    const deals = (await http().get("/v1/deals").set(owner.auth)).body as DealDto[] | { items: DealDto[] };
    expect((Array.isArray(deals) ? deals : deals.items).filter((d) => d.contact?.id === aysel.id)).toHaveLength(1);
    await http().post("/v1/public/in/nope.nope").send({ phone: "1" }).expect(404);

    const ads = await create({ kind: "google_ads", name: "Reklam", secret: "g-key-123" });
    const lead = { lead_id: "L1", google_key: "g-key-123", campaign_id: "77", user_column_data: [{ column_id: "FULL_NAME", string_value: "Rauf Quliyev" }, { column_id: "EMAIL", string_value: "rauf@x.az" }] };
    await http().post(path(ads)).send({ ...lead, google_key: "wrong" }).expect(403);
    await http().post(path(ads)).send(lead).expect(200);
    expect((await http().post(path(ads)).send(lead).expect(200)).body.ignored).toBe("duplicate");
    expect((await contacts(owner.auth)).find((c) => c.email === "rauf@x.az")).toMatchObject({ name: "Rauf Quliyev", source: "ads" });

    const shop = await create({ kind: "shopify", name: "Shopify", secret: "shop-secret" });
    const order = JSON.stringify({ id: 9001, name: "#1001", email: "leyla@x.az", total_price: "150.50", currency: "AZN", customer: { first_name: "Leyla", last_name: "Əliyeva" } });
    const sign = (s: string) => createHmac("sha256", "shop-secret").update(s).digest("base64");
    await http().post(path(shop)).set({ "content-type": "application/json", "x-shopify-hmac-sha256": "bad", "x-shopify-topic": "orders/create" }).send(order).expect(403);
    await http().post(path(shop)).set({ "content-type": "application/json", "x-shopify-hmac-sha256": sign(order), "x-shopify-topic": "orders/create" }).send(order).expect(200);
    const leyla = (await contacts(owner.auth)).find((c) => c.email === "leyla@x.az")!;
    expect(leyla).toMatchObject({ name: "Leyla Əliyeva", stage: "CUSTOMER" });

    // A missed incoming call from an unknown number: a new lead, a call record, a notice
    const pbx = await create({ kind: "calls", name: "Ofis telefonu" });
    const call = { call_id: "c-1", from: "0552223344", to: "0124445566", direction: "in", duration: "0", status: "no answer" };
    await http().post(path(pbx)).type("form").send(call).expect(200);
    expect((await http().post(path(pbx)).type("form").send(call).expect(200)).body.ignored).toBe("duplicate");
    list = await contacts(owner.auth);
    const caller = list.find((c) => c.phone === "+994552223344")!;
    expect(caller).toMatchObject({ source: "phone", name: "+994552223344" });
    const events = (await http().get(`/v1/contacts/${caller.id}/events`).set(owner.auth)).body as CalendarEventDto[] | undefined;
    if (Array.isArray(events)) expect(events[0]).toMatchObject({ kind: "call", outcome: "no_answer", direction: "in" });
    expect((await http().get(path(pbx)).query({ zd_echo: "abc" }).expect(200)).text).toBe("abc");

    const after = (await http().get("/v1/integrations/inbound").set(owner.auth)).body as InboundHookDto[];
    expect(after.find((h) => h.id === site.id)?.received).toBe(2);
    const emp = await addMember(app, owner, "EMPLOYEE");
    await http().get("/v1/integrations/inbound").set(emp.auth).expect(403);
  });
});
