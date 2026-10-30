import { Logger } from "../common/logger";
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config";
import { afterResponse } from "../common/after-response";
import { JobsMonitor } from "../common/jobs-monitor";
import type { Database, Tx } from "../db/database";
import { mailLocale, renderMail, type MailTemplate } from "./templates";

const SWEEP_MS = 30_000;
const BATCH = 25;
const MAX_ATTEMPTS = 5;

export interface QueuedMail {
  tenantId?: string | null;
  to: string;
  locale?: string | null;
  /** Email channel replies: custom sender and threading headers */
  from?: string;
  headers?: Record<string, string>;
  /** Pre-rendered message (email channel); otherwise rendered from `template` */
  raw?: { subject: string; text: string; html: string };
  /** Email channel: the inbox message whose delivery status follows this email */
  inboxMessageId?: string;
}

/**
 * Outgoing email (outbox pattern, like automations): `queue()` writes the message in
 * the caller's transaction, the sender delivers it after commit and retries failures.
 * Without SMTP_URL nothing is delivered: messages end as "not_sent" — never "sent".
 */
export class MailService {
  private readonly logger = new Logger("Mail");
  private transport?: Transporter;
  private sweep?: NodeJS.Timeout;
  private sending?: Promise<number>;

  constructor(
    private readonly db: Database,
    private readonly monitor: JobsMonitor,
  ) {}

  start() {
    this.monitor.register("mail");
    if (!config().JOBS_ENABLED) return;
    this.sweep = setInterval(() => void this.monitor.track("mail", () => this.send()), SWEEP_MS);
  }

  stop() {
    clearInterval(this.sweep);
    this.transport?.close();
  }

  get configured() {
    return !!config().SMTP_URL;
  }

  async queue(tx: Tx, mail: QueuedMail & Partial<MailTemplate>) {
    const rendered = mail.raw ?? renderMail({ template: mail.template!, vars: mail.vars! } as MailTemplate, mailLocale(mail.locale));
    await tx.emailMessage.insertOne({
      tenantId: mail.tenantId ?? null,
      to: mail.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      template: mail.template ?? "inbox_reply",
      from: mail.from ?? null,
      headers: mail.headers ?? {},
      inboxMessageId: mail.inboxMessageId ?? null,
    });
    this.soon();
  }

  private soon() {
    if (!config().JOBS_ENABLED) return;
    // Wait out a pass already in flight: it may have looked before this mail committed
    afterResponse(async () => {
      await this.sending;
      await this.monitor.track("mail", () => this.send());
    });
  }

  /** Delivers queued mail; returns how many were handled. Concurrent calls share one pass. */
  send(): Promise<number> {
    this.sending ??= this.sendOnce().finally(() => (this.sending = undefined));
    return this.sending;
  }

  private transporter() {
    this.transport ??= nodemailer.createTransport(config().SMTP_URL!);
    return this.transport;
  }

  private async sendOnce(): Promise<number> {
    const db = this.db.system;
    let handled = 0;
    // A failed message goes back to "queued" but waits for the next pass (30 s later)
    const tried: string[] = [];
    for (;;) {
      const batch = await db.emailMessage.find({ status: "queued", id: { $nin: tried } }, { sort: { createdAt: 1 }, limit: BATCH });
      if (!batch.length) return handled;
      for (const m of batch) {
        tried.push(m.id);
        const claimed = await db.emailMessage.updateMany({ id: m.id, status: "queued" }, { $set: { status: "sending" }, $inc: { attempts: 1 } });
        if (!claimed.count) continue;
        handled += 1;
        if (!this.configured) {
          if (process.env.NODE_ENV !== "production") this.logger.log(`not sent (no SMTP_URL) → ${m.to}: ${m.subject}\n${m.text}`);
          await db.emailMessage.update({ id: m.id }, { $set: { status: "not_sent", error: "SMTP_URL is not configured" } });
          await this.inboxStatus(m.inboxMessageId, "failed");
          continue;
        }
        try {
          await this.transporter().sendMail({
            from: m.from ?? config().MAIL_FROM,
            to: m.to,
            subject: m.subject,
            text: m.text,
            html: m.html,
            headers: m.headers as Record<string, string>,
          });
          await db.emailMessage.update({ id: m.id }, { $set: { status: "sent", sentAt: new Date(), error: null } });
          await this.inboxStatus(m.inboxMessageId, "sent");
        } catch (e) {
          const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
          const final = m.attempts + 1 >= MAX_ATTEMPTS;
          await db.emailMessage.update({ id: m.id }, { $set: { status: final ? "failed" : "queued", error } });
          if (final) await this.inboxStatus(m.inboxMessageId, "failed");
        }
      }
    }
  }

  /** Email channel replies: the conversation shows whether the email actually left. */
  private async inboxStatus(messageId: string | null, status: "sent" | "failed") {
    if (!messageId) return;
    await this.db.system.message.updateMany({ id: messageId }, { $set: { deliveryStatus: status } });
  }
}
