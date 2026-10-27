import type { INestApplication } from "@nestjs/common";
import type { ChannelDto, ConversationDetailDto } from "@axis/shared";
import nodemailer from "nodemailer";
import request from "supertest";
import { config } from "../src/config";
import { MailService } from "../src/mail/mail.service";
import { createApp, signup, uniqueEmail, withRawDb } from "./helpers";

describe("Email channel", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  /** Pretend SMTP is configured, with nodemailer's JSON transport standing in for the server. */
  function withSmtp() {
    const cfg = config() as { SMTP_URL?: string };
    const mail = app.get(MailService) as unknown as { transport?: unknown };
    cfg.SMTP_URL = "smtp://smtp.test:587";
    mail.transport = nodemailer.createTransport({ jsonTransport: true });
    return () => {
      cfg.SMTP_URL = undefined;
      mail.transport = undefined;
    };
  }

  it("demo email channel: simulated messages, replies never leave the system", async () => {
    const owner = await signup(app);
    const ch = (await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "EMAIL", name: "Satış (demo)", address: "satis@demo.az", demo: true }).expect(201)).body as ChannelDto;
    expect(ch.inboundUrl).toBeUndefined();
    const sim = (await http().post(`/v1/inbox/channels/${ch.id}/simulate`).set(owner.auth).send({ from: "aysu@mail.az", name: "Aysu", body: "Qiymət?" }).expect(201)).body;
    const reply = (await http().post(`/v1/inbox/conversations/${sim.conversationId}/messages`).set(owner.auth).send({ body: "Salam!" }).expect(201)).body;
    expect(reply.deliveryStatus).toBe("demo");
    expect(await withRawDb((db) => db.emailMessage.count({ where: { to: "aysu@mail.az" } }))).toBe(0);
  });

  it("a real email channel needs SMTP", async () => {
    const owner = await signup(app);
    const res = await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "EMAIL", name: "Satış", address: uniqueEmail("sales") }).expect(502);
    expect(res.body.error).toMatchObject({ code: "CHANNEL_ERROR", details: { reason: "smtp" } });
  });

  it("inbound webhook → conversation; reply goes out from the channel address, threaded", async () => {
    const restore = withSmtp();
    try {
      const owner = await signup(app, "Poçt Satış MMC");
      const address = uniqueEmail("sales");
      const ch = (await http().post("/v1/inbox/channels").set(owner.auth).send({ type: "EMAIL", name: "Satış", address }).expect(201)).body as ChannelDto;
      const url = new URL(ch.inboundUrl!);
      expect(url.pathname).toBe(`/v1/webhooks/email/${ch.id}`);
      const token = url.searchParams.get("token")!;
      // The secret is shown once
      const listed = (await http().get("/v1/inbox/channels").set(owner.auth).expect(200)).body as ChannelDto[];
      expect(listed.find((c) => c.id === ch.id)?.inboundUrl).toBeUndefined();

      const customer = uniqueEmail("customer");
      const payload = {
        FromFull: { Email: customer.toUpperCase(), Name: "Leyla Məmmədova" },
        Subject: "Sifariş",
        TextBody: "Salam, sifarişim haradadır?\n\n> köhnə mətn",
        StrippedTextReply: "Salam, sifarişim haradadır?",
        MessageID: "<abc123@mail.example>",
      };
      await http().post(`/v1/webhooks/email/${ch.id}`).query({ token: "wrong" }).send(payload).expect(403);
      expect((await http().post(`/v1/webhooks/email/${ch.id}`).query({ token }).send(payload).expect(200)).body).toEqual({ stored: 1 });
      expect((await http().post(`/v1/webhooks/email/${ch.id}`).query({ token }).send(payload).expect(200)).body).toEqual({ stored: 0 });

      const conv = await withRawDb((db) => db.conversation.findFirstOrThrow({ where: { channelId: ch.id } }));
      expect(conv).toMatchObject({ handle: customer, displayName: "Leyla Məmmədova", subject: "Sifariş", emailReplyTo: "<abc123@mail.example>" });
      const detail = (await http().get(`/v1/inbox/conversations/${conv.id}`).set(owner.auth).expect(200)).body as ConversationDetailDto;
      expect(detail.messages.map((m) => m.body)).toEqual(["Salam, sifarişim haradadır?"]);

      const reply = (await http().post(`/v1/inbox/conversations/${conv.id}/messages`).set(owner.auth).send({ body: "Sabah çatdırılacaq." }).expect(201)).body;
      expect(reply.deliveryStatus).toBe("queued");
      const mail = await withRawDb((db) => db.emailMessage.findFirstOrThrow({ where: { to: customer } }));
      expect(mail).toMatchObject({ subject: "Re: Sifariş", from: `"Poçt Satış MMC" <${address}>`, headers: { "In-Reply-To": "<abc123@mail.example>", References: "<abc123@mail.example>" } });

      await app.get(MailService).send();
      const after = (await http().get(`/v1/inbox/conversations/${conv.id}`).set(owner.auth).expect(200)).body as ConversationDetailDto;
      expect(after.messages.find((m) => m.id === reply.id)?.deliveryStatus).toBe("sent");

      // Another company's channel id with this token is refused
      const other = await signup(app);
      const otherCh = (await http().post("/v1/inbox/channels").set(other.auth).send({ type: "EMAIL", name: "B", address: uniqueEmail("b") }).expect(201)).body as ChannelDto;
      await http().post(`/v1/webhooks/email/${otherCh.id}`).query({ token }).send(payload).expect(403);
    } finally {
      restore();
    }
  });
});
