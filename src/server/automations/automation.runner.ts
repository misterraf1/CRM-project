import type { AutomationAction, AutomationConditions, AutomationTrigger } from "@/shared";
import type { AutomationEvent, AutomationRule } from "../db/models";
import { EntitlementsService, subscriptionOf } from "../billing/entitlements.service";
import { config } from "../config";
import { afterResponse } from "../common/after-response";
import { JobsMonitor } from "../common/jobs-monitor";
import { InboxEvents } from "../inbox/events";
import { NotificationsService } from "../notifications/notifications.service";
import type { Database, Tx } from "../db/database";
import { ActivityService } from "../crm/activity.service";
import { MailService } from "../mail/mail.service";

const DAY_MS = 86_400_000;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const SWEEP_MS = 30_000;
const BATCH = 50;
const MAX_ATTEMPTS = 3;
/** A worker that died mid-event leaves it "processing"; it is retried after this */
const STUCK_MS = 5 * 60_000;

export type AutomationPayload =
  | { dealId: string; fromStageId?: string; toStageId?: string }
  | { contactId: string }
  | { conversationId: string }
  | { taskId: string }
  | { docId: string }
  | { orderId: string }
  | { caseId: string };

/** The record an event is about, reduced to what conditions and actions need. */
interface Subject {
  kind: "deal" | "contact" | "conversation" | "task" | "doc" | "order" | "case";
  id: string;
  ownerId: string | null;
  title: string;
  links: { dealId?: string; contactId?: string; conversationId?: string; taskId?: string; docId?: string; orderId?: string; caseId?: string };
  stageId?: string;
  amount?: number;
  source?: string | null;
  channelType?: string;
  /** contact.inactive: whole days since the contact's last activity */
  inactiveDays?: number;
}

/**
 * Executes automation rules (outbox pattern):
 *  1. services call `enqueue(tx, …)` inside their own transaction — the event commits
 *     or rolls back together with the change that caused it;
 *  2. right after commit (and on a 30 s sweep) `drain()` claims pending events and runs
 *     the tenant's matching rules, each rule in its own transaction;
 *  3. actions write directly (never through the services), so they don't emit events
 *     themselves — rules can't trigger each other in a loop.
 * Claiming is a conditional update, so several API instances never run an event twice.
 */
export class AutomationRunner {
  private sweep?: NodeJS.Timeout;
  private draining?: Promise<number>;

  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationsService,
    private readonly entitlements: EntitlementsService,
    private readonly inboxEvents: InboxEvents,
    private readonly monitor: JobsMonitor,
    private readonly activity: ActivityService,
    private readonly mail: MailService,
  ) {}

  start() {
    this.monitor.register("automations");
    if (!config().JOBS_ENABLED) return;
    this.sweep = setInterval(() => void this.monitor.track("automations", () => this.drain()), SWEEP_MS);
  }

  stop() {
    clearInterval(this.sweep);
  }

  /** Records an event if the tenant has an enabled rule for it. Call inside the change's transaction. */
  async enqueue(tx: Tx, tenantId: string, trigger: AutomationTrigger, payload: AutomationPayload) {
    if (!(await tx.automationRule.count({ tenantId, trigger, enabled: true }))) return;
    await tx.automationEvent.insertOne({ tenantId, trigger, payload });
    this.soon();
  }

  /** Runs once the surrounding request has committed (the sweep / cron catches anything missed). */
  private soon() {
    if (!config().JOBS_ENABLED) return;
    // Wait out a pass already in flight: it may have looked before this event committed
    afterResponse(async () => {
      await this.draining;
      await this.monitor.track("automations", () => this.drain());
    });
  }

  /** Processes pending events; returns how many were handled. Concurrent calls share one pass. */
  drain(): Promise<number> {
    this.draining ??= this.drainOnce().finally(() => (this.draining = undefined));
    return this.draining;
  }

  private async drainOnce(): Promise<number> {
    const events = this.db.system.automationEvent;
    await events.updateMany({ status: "processing", createdAt: { $lt: new Date(Date.now() - STUCK_MS) } }, { $set: { status: "pending" } });
    let handled = 0;
    for (;;) {
      const batch = await events.find({ status: "pending" }, { sort: { createdAt: 1 }, limit: BATCH });
      if (!batch.length) return handled;
      for (const event of batch) {
        const claimed = await events.updateMany({ id: event.id, status: "pending" }, { $set: { status: "processing" }, $inc: { attempts: 1 } });
        if (!claimed.count) continue;
        try {
          await this.process(event);
          await events.update({ id: event.id }, { $set: { status: "done", processedAt: new Date(), error: null } });
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          await events.update({ id: event.id }, { $set: { status: event.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending", error } });
        }
        handled += 1;
      }
    }
  }

  private async process(event: AutomationEvent) {
    const tenantId = event.tenantId;
    const payload = event.payload as AutomationPayload;
    const { rules, subject } = await this.db.scoped(
      async (tx) => {
        const sub = await subscriptionOf(tx, tenantId).catch(() => null);
        // Downgraded or inactive companies keep their rules but nothing runs
        if (!sub || !this.entitlements.features(sub).includes("automations") || sub.status === "SUSPENDED" || sub.status === "CANCELED") {
          return { rules: [], subject: null };
        }
        const rules = await tx.automationRule.find({ tenantId, trigger: event.trigger, enabled: true }, { sort: { createdAt: 1 } });
        return { rules, subject: rules.length ? await this.subject(tx, event.trigger as AutomationTrigger, payload) : null };
      },
      { tenantId },
    );
    if (!subject) return;
    for (const rule of rules) {
      if (!this.matches(rule.conditions as AutomationConditions, subject, payload)) continue;
      await this.runRule(rule, event, subject);
    }
  }

  private async subject(tx: Tx, trigger: AutomationTrigger, payload: AutomationPayload): Promise<Subject | null> {
    if (trigger === "deal.created" || trigger === "deal.stage_changed") {
      const deal = await tx.deal.findOne({ id: (payload as { dealId: string }).dealId });
      return deal && {
        kind: "deal",
        id: deal.id,
        ownerId: deal.ownerId,
        title: deal.title,
        links: { dealId: deal.id, ...(deal.contactId ? { contactId: deal.contactId } : {}) },
        stageId: deal.stageId,
        // Conditions compare in the company currency
        amount: deal.baseAmount ?? deal.amount,
      };
    }
    if (trigger === "contact.created" || trigger === "contact.inactive") {
      const c = await tx.contact.findOne({ id: (payload as { contactId: string }).contactId });
      if (!c || c.deletedAt) return null;
      const since = c.lastActivityAt ?? c.createdAt;
      const subject: Subject = { kind: "contact", id: c.id, ownerId: c.ownerId, title: c.name, links: { contactId: c.id }, source: c.source };
      if (trigger === "contact.inactive") subject.inactiveDays = Math.floor((Date.now() - since.getTime()) / DAY_MS);
      return subject;
    }
    if (trigger === "quote.accepted" || trigger === "invoice.paid") {
      const d = await tx.salesDoc.findOne({ id: (payload as { docId: string }).docId });
      return d && {
        kind: "doc",
        id: d.id,
        ownerId: d.ownerId,
        title: d.number ?? "",
        links: { docId: d.id, contactId: d.contactId, ...(d.dealId ? { dealId: d.dealId } : {}) },
        amount: d.baseTotal,
      };
    }
    if (trigger === "order.done") {
      const o = await tx.order.findOne({ id: (payload as { orderId: string }).orderId });
      return o && { kind: "order", id: o.id, ownerId: o.ownerId, title: o.title, links: { orderId: o.id, contactId: o.contactId, ...(o.dealId ? { dealId: o.dealId } : {}) } };
    }
    if (trigger === "case.created") {
      const c = await tx.serviceCase.findOne({ id: (payload as { caseId: string }).caseId });
      return c && { kind: "case", id: c.id, ownerId: c.assigneeId, title: c.subject, links: { caseId: c.id, contactId: c.contactId, ...(c.dealId ? { dealId: c.dealId } : {}), ...(c.orderId ? { orderId: c.orderId } : {}) } };
    }
    if (trigger === "conversation.created" || trigger === "conversation.unanswered") {
      const c = await tx.conversation.findOne({ id: (payload as { conversationId: string }).conversationId });
      if (!c) return null;
      const [channel, contact] = await Promise.all([
        tx.channel.findOne({ id: c.channelId }, { projection: { type: 1 } }),
        c.contactId ? tx.contact.findOne({ id: c.contactId }, { projection: { name: 1 } }) : null,
      ]);
      return {
        kind: "conversation",
        id: c.id,
        ownerId: c.assigneeId,
        title: contact?.name ?? c.displayName ?? c.handle ?? "",
        links: { conversationId: c.id, ...(c.contactId ? { contactId: c.contactId } : {}) },
        channelType: channel?.type,
      };
    }
    const t = await tx.task.findOne({ id: (payload as { taskId: string }).taskId });
    return t && {
      kind: "task",
      id: t.id,
      ownerId: t.assigneeId,
      title: t.title,
      links: { taskId: t.id, ...(t.contactId ? { contactId: t.contactId } : {}), ...(t.dealId ? { dealId: t.dealId } : {}) },
    };
  }

  private matches(c: AutomationConditions, s: Subject, payload: AutomationPayload): boolean {
    if (c.stageId) {
      // Stage changes match on the stage entered; new deals on their starting stage
      const stage = "toStageId" in payload && payload.toStageId ? payload.toStageId : s.stageId;
      if (stage !== c.stageId) return false;
    }
    if (c.minAmount !== undefined && (s.amount ?? 0) < c.minAmount) return false;
    if (c.source && s.source !== c.source) return false;
    if (c.channelType && s.channelType !== c.channelType) return false;
    if (s.inactiveDays !== undefined && s.inactiveDays < (c.inactiveDays ?? 30)) return false;
    return true;
  }

  private async runRule(rule: AutomationRule, event: AutomationEvent, subject: Subject) {
    const tenantId = rule.tenantId;
    try {
      const detail = await this.db.scoped(
        async (tx) => {
          const done: string[] = [];
          for (const action of rule.actions as AutomationAction[]) done.push(await this.act(tx, rule, subject, action));
          await tx.automationRule.update({ id: rule.id }, { $inc: { runCount: 1 }, $set: { lastRunAt: new Date(), lastError: null } });
          await tx.automationRun.insertOne({ tenantId, ruleId: rule.id, eventId: event.id, status: "success", detail: done.join("; ") });
          return done;
        },
        { tenantId },
      );
      if (subject.kind === "conversation" && detail.some((d) => d.startsWith("assigned"))) {
        this.inboxEvents.publish(tenantId, { type: "conversation", conversationId: subject.id });
      }
    } catch (e) {
      // One broken rule must not stop the others; the failure is shown on the rule
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await this.db.scoped(
        async (tx) => {
          await tx.automationRule.update({ id: rule.id }, { $set: { lastRunAt: new Date(), lastError: error } });
          await tx.automationRun.insertOne({ tenantId, ruleId: rule.id, eventId: event.id, status: "failed", detail: error });
        },
        { tenantId },
      );
    }
  }

  private async activeMembers(tx: Tx, tenantId: string, ids: string[]) {
    const rows = await tx.membership.find({ tenantId, id: { $in: ids }, status: "ACTIVE" }, { projection: { id: 1 } });
    const ok = new Set(rows.map((r) => r.id));
    return ids.filter((id) => ok.has(id));
  }

  private async act(tx: Tx, rule: AutomationRule, s: Subject, action: AutomationAction): Promise<string> {
    const tenantId = rule.tenantId;
    const meta = { ...s.links, ruleName: rule.name };

    if (action.type === "create_task") {
      const wanted = action.assignee === "owner" ? s.ownerId : action.assignee;
      const [assigneeId] = wanted ? await this.activeMembers(tx, tenantId, [wanted]) : [];
      const task = await tx.task.insertOne({
        tenantId,
        title: action.title.replaceAll("{title}", s.title).slice(0, 200),
        priority: action.priority,
        creatorId: rule.createdById,
        assigneeId: assigneeId ?? null,
        dueAt: new Date(Date.now() + action.dueInDays * 86_400_000),
        dealId: s.links.dealId ?? null,
        contactId: s.links.contactId ?? null,
      });
      if (assigneeId) await this.notifications.notify(tx, tenantId, [assigneeId], "task_assigned", { taskId: task.id, title: task.title, actorName: rule.name });
      return `task ${task.id}`;
    }

    if (action.type === "notify") {
      let recipients: string[] = [];
      if (action.recipient === "owner") recipients = s.ownerId ? [s.ownerId] : [];
      else if (action.recipient === "managers") recipients = await this.managersOf(tx, tenantId, s.ownerId);
      else recipients = await this.activeMembers(tx, tenantId, [action.recipient]);
      await this.notifications.notify(tx, tenantId, recipients, "automation", { ...meta, title: action.message.replaceAll("{title}", s.title) });
      return `notified ${recipients.length}`;
    }

    if (action.type === "move_stage") {
      if (!s.links.dealId) return "move skipped (no deal)";
      const deal = await tx.deal.findOne({ id: s.links.dealId, tenantId });
      const to = deal && (await tx.pipelineStage.findOne({ id: action.stageId, tenantId, pipelineId: deal.pipelineId }));
      if (!deal || !to) return "move skipped (stage not in the deal's pipeline)";
      const from = await tx.pipelineStage.findOne({ id: deal.stageId });
      if (to.id === deal.stageId || from?.kind !== "open" || to.kind === "lost") return "move skipped";
      const last = await tx.deal.findOne({ stageId: to.id }, { sort: { position: -1 }, projection: { position: 1 } });
      await tx.deal.update({ id: deal.id }, { $set: { stageId: to.id, position: (last?.position ?? 0) + 1024, closedAt: to.kind === "won" ? new Date() : null } });
      const base = { dealId: deal.id, contactId: deal.contactId, tenantId };
      await this.activity.record(tx, { ...base, type: "deal_stage", payload: { dealTitle: deal.title, from: from.name, to: to.name, automation: rule.name } });
      if (to.kind === "won") {
        await this.activity.record(tx, { ...base, type: "deal_won", payload: { dealTitle: deal.title, amount: deal.amount } });
        const contact = deal.contactId ? await tx.contact.findOne({ id: deal.contactId }) : null;
        if (contact && !contact.deletedAt && contact.stage !== "CUSTOMER") {
          await tx.contact.update({ id: contact.id }, { $set: { stage: "CUSTOMER" } });
          await this.activity.record(tx, { tenantId, type: "contact_stage", contactId: contact.id, payload: { contactName: contact.name, from: contact.stage, to: "CUSTOMER", automatic: true } });
        }
      }
      return `moved to ${to.name}`;
    }

    if (action.type === "send_email") {
      const contact = s.links.contactId ? await tx.contact.findOne({ id: s.links.contactId, tenantId }) : null;
      if (!contact?.email || contact.deletedAt) return "email skipped (no address)";
      const tenant = await tx.tenant.get({ id: tenantId }, { projection: { name: 1, locale: 1 } });
      const fill = (text: string) => text.replaceAll("{name}", contact.name).replaceAll("{title}", s.title);
      const text = fill(action.body);
      await this.mail.queue(tx, {
        tenantId,
        to: contact.email,
        locale: tenant.locale,
        raw: { subject: fill(action.subject), text: `${text}\n\n— ${tenant.name}`, html: `<p>${escapeHtml(text).replaceAll("\n", "<br>")}</p><p>— ${escapeHtml(tenant.name)}</p>` },
      });
      return `email to ${contact.email}`;
    }

    // assign: one member, or the next one in turn — skipping operators who set themselves away
    // (if everyone is away the work is still handed out rather than left unassigned)
    const active = await this.activeMembers(tx, tenantId, action.memberIds);
    const away = new Set((await tx.membership.find({ tenantId, id: { $in: active }, presence: "away" }, { projection: { id: 1 } })).map((m) => m.id));
    const pool = active.some((id) => !away.has(id)) ? active.filter((id) => !away.has(id)) : active;
    if (!pool.length) return "assign skipped (no active member)";
    const { rrCursor } = await tx.automationRule.update({ id: rule.id }, { $inc: { rrCursor: 1 } });
    const memberId = pool[(rrCursor - 1) % pool.length]!;
    if (s.kind === "deal") await tx.deal.update({ id: s.id }, { $set: { ownerId: memberId } });
    else if (s.kind === "contact") await tx.contact.update({ id: s.id }, { $set: { ownerId: memberId } });
    else if (s.kind === "conversation") await tx.conversation.update({ id: s.id }, { $set: { assigneeId: memberId } });
    else if (s.kind === "doc") await tx.salesDoc.update({ id: s.id }, { $set: { ownerId: memberId } });
    else if (s.kind === "order") await tx.order.update({ id: s.id }, { $set: { ownerId: memberId } });
    else if (s.kind === "case") await tx.serviceCase.update({ id: s.id }, { $set: { assigneeId: memberId } });
    else await tx.task.update({ id: s.id }, { $set: { assigneeId: memberId } });
    s.ownerId = memberId; // later actions in the same rule ("notify owner") reach the new owner
    return `assigned ${memberId}`;
  }

  /** Owners and admins, plus managers of the record owner's department. */
  private async managersOf(tx: Tx, tenantId: string, ownerId: string | null) {
    const owner = ownerId ? await tx.membership.findOne({ id: ownerId, tenantId }, { projection: { departmentId: 1 } }) : null;
    const rows = await tx.membership.find(
      { tenantId, status: "ACTIVE", $or: [{ role: { $in: ["OWNER", "ADMIN"] } }, ...(owner?.departmentId ? [{ role: "MANAGER", departmentId: owner.departmentId }] : [])] },
      { projection: { id: 1 } },
    );
    return rows.map((r) => r.id);
  }
}
