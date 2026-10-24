import type { INestApplication } from "@nestjs/common";
import type { CheckoutResponse, InviteCreatedResponse, SystemHealthDto } from "@axis/shared";
import nodemailer from "nodemailer";
import request from "supertest";
import { config } from "../src/config";
import { MailService } from "../src/mail/mail.service";
import { createApp, platformStaff, signup, uniqueEmail, withRawDb, PASSWORD } from "./helpers";

describe("Email", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const mailTo = (to: string) => withRawDb((db) => db.emailMessage.findMany({ where: { to }, orderBy: { createdAt: "asc" } }));

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it("without SMTP nothing is reported as sent; with SMTP the queue delivers", async () => {
    const owner = await signup(app, "Poçt MMC");
    const email = uniqueEmail("invitee");
    const invite = (await http().post("/v1/members/invites").set(owner.auth).send({ email, role: "EMPLOYEE" }).expect(201)).body as InviteCreatedResponse;
    expect(invite.emailDelivery).toBe("not_configured");
    const [queued] = await mailTo(email);
    expect(queued).toMatchObject({ template: "invite", status: "queued", subject: "Poçt MMC sizi Axis-ə dəvət edir" });
    expect(queued!.text).toContain(invite.invitePath);
    expect(queued!.html).toContain(invite.invitePath);

    await app.get(MailService).send();
    expect((await mailTo(email))[0]).toMatchObject({ status: "not_sent", error: "SMTP_URL is not configured" });

    // A real transport (nodemailer's JSON transport stands in for an SMTP server)
    const cfg = config() as { SMTP_URL?: string };
    const mail = app.get(MailService) as unknown as { transport?: unknown };
    cfg.SMTP_URL = "smtp://smtp.test:587";
    mail.transport = nodemailer.createTransport({ jsonTransport: true });
    try {
      const email2 = uniqueEmail("invitee");
      const again = (await http().post("/v1/members/invites").set(owner.auth).send({ email: email2, role: "EMPLOYEE" }).expect(201)).body as InviteCreatedResponse;
      expect(again.emailDelivery).toBe("queued");
      await app.get(MailService).send();
      expect((await mailTo(email2))[0]).toMatchObject({ status: "sent", error: null });
    } finally {
      cfg.SMTP_URL = undefined;
      mail.transport = undefined;
    }
  });

  it("password reset: same answer for unknown emails, one-time link, signs out everywhere", async () => {
    const owner = await signup(app);
    await http().post("/v1/auth/password/forgot").send({ email: uniqueEmail("nobody") }).expect(204);

    await http().post("/v1/auth/password/forgot").send({ email: owner.email }).expect(204);
    await http().post("/v1/auth/password/forgot").send({ email: owner.email }).expect(204);
    const mails = await mailTo(owner.email);
    const tokens = mails.filter((m) => m.template === "password_reset").map((m) => /reset-password\/([\w-]+)/.exec(m.text)![1]!);
    expect(tokens).toHaveLength(2);

    // Only the newest link works
    await http().post("/v1/auth/password/reset").send({ token: tokens[0], password: "Yeni-parol-123" }).expect(400);
    await http().post("/v1/auth/password/reset").send({ token: tokens[1], password: "short" }).expect(400);
    await http().post("/v1/auth/password/reset").send({ token: tokens[1], password: "Yeni-parol-123" }).expect(204);
    const reused = await http().post("/v1/auth/password/reset").send({ token: tokens[1], password: "Basqa-parol-123" }).expect(400);
    expect(reused.body.error.code).toBe("TOKEN_INVALID");

    await http().get("/v1/me").set(owner.auth).expect(401);
    await http().post("/v1/auth/login").send({ email: owner.email, password: PASSWORD }).expect(401);
    await http().post("/v1/auth/login").send({ email: owner.email, password: "Yeni-parol-123" }).expect(200);
  });

  it("receipts to owners, support replies to the author; platform sees counts, never bodies", async () => {
    const owner = await signup(app, "Qəbz MMC");
    const co = (await http().post("/v1/billing/checkout").set(owner.auth).send({ planCode: "PRO", interval: "MONTH" }).expect(201)).body as CheckoutResponse;
    await http().post(`/v1/billing/demo/invoices/${co.invoice.id}/complete`).set(owner.auth).send({ outcome: "success" }).expect(200);
    const receipt = (await mailTo(owner.email)).find((m) => m.template === "invoice_paid");
    expect(receipt?.subject).toBe(`Ödəniş qəbul edildi — ${co.invoice.number}`);
    expect(receipt?.text).toContain("99.00 AZN");

    const ticket = (await http().post("/v1/support/tickets").set(owner.auth).send({ subject: "Sual", body: "Kömək edin" }).expect(201)).body;
    const staff = await platformStaff(app, "SUPPORT");
    await http().post(`/v1/admin/tickets/${ticket.id}/messages`).set(staff.auth).send({ body: "Cavab" }).expect(201);
    expect((await mailTo(owner.email)).find((m) => m.template === "support_reply")?.text).toContain(`/support/${ticket.id}`);

    const system = (await http().get("/v1/admin/system").set(staff.auth).expect(200)).body as SystemHealthDto;
    expect(system.mail.configured).toBe(false);
    expect(system.mail.queued).toBeGreaterThan(0);
    expect(system.mail.recent[0]).not.toHaveProperty("text");
    expect(system.mail.recent[0]).not.toHaveProperty("html");
  });
});
