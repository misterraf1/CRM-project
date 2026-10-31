import {
  DEFAULT_INBOX_SETTINGS,
  type CalendarEventDto,
  type CalendarFeedDto,
  type CalendarTaskDto,
  type CallLogInput,
  type EventCreateInput,
  type EventOutcome,
  type EventUpdateInput,
  type TodayDto,
} from "@/shared";
import type { z } from "zod";
import type { calendarQuerySchema } from "@/shared";
import { ActivityService } from "../crm/activity.service";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { addDays, startOfDay } from "../common/time";
import { memberRefs, ownerScope } from "../crm/scope";
import type { Database, Tx } from "../db/database";
import type { CalendarEvent, Task } from "../db/models";
import { and } from "../db/query";
import type { Filter } from "../db/repo";
import { NotificationsService } from "../notifications/notifications.service";
import { nextOccurrence, taskScope } from "../tasks/tasks.service";

type CalendarQuery = z.infer<typeof calendarQuerySchema>;

/** Safety cap when expanding a recurring event (a daily event for ~5 years) */
const MAX_STEPS = 2000;

/** Starts of the occurrences of `ev` that overlap [from, to). */
export function occurrences(ev: Pick<CalendarEvent, "startAt" | "endAt" | "recurrence">, from: Date, to: Date): Date[] {
  const length = ev.endAt.getTime() - ev.startAt.getTime();
  if (!ev.recurrence) return ev.startAt < to && ev.startAt.getTime() + Math.max(length, 1) > from.getTime() ? [ev.startAt] : [];
  const out: Date[] = [];
  let start = ev.startAt;
  for (let i = 0; i < MAX_STEPS && start < to; i++) {
    if (start.getTime() + Math.max(length, 1) > from.getTime()) out.push(start);
    start = nextOccurrence(ev.recurrence, start);
  }
  return out;
}

/** When the reminder for the first occurrence starting after `after` fires (null = none left). */
export function nextRemindAt(ev: Pick<CalendarEvent, "startAt" | "endAt" | "recurrence" | "reminderMinutes">, after: Date): Date | null {
  if (ev.reminderMinutes == null) return null;
  let start = ev.startAt;
  for (let i = 0; start <= after; i++) {
    if (!ev.recurrence || i >= MAX_STEPS) return null;
    start = nextOccurrence(ev.recurrence, start);
  }
  return new Date(start.getTime() - ev.reminderMinutes * 60_000);
}

/** Task reminder: `reminderMinutes` before the deadline, only while it's ahead. */
export function taskRemindAt(task: Pick<Task, "dueAt" | "reminderMinutes" | "status">, now = new Date()): Date | null {
  if (!task.dueAt || task.reminderMinutes == null || task.dueAt <= now || task.status === "DONE" || task.status === "CANCELED") return null;
  return new Date(task.dueAt.getTime() - task.reminderMinutes * 60_000);
}

/**
 * Who sees an event: like tasks — everything with tasks.view_all, the department for
 * managers, otherwise events the member owns or attends.
 */
async function eventScope(tx: Tx, ctx: AuthedContext) {
  const s = await ownerScope(tx, ctx, "tasks.view_all");
  const where: Filter = s.memberIds ? { $or: [{ ownerId: { $in: s.memberIds } }, { attendeeIds: { $in: s.memberIds } }] } : {};
  return { memberIds: s.memberIds, where };
}

const OPEN_TASK: Filter = { status: { $nin: ["DONE", "CANCELED"] } };

export class CalendarService {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
  ) {}

  /** Whose events and tasks: "mine", "all" (within scope) or one member (within scope). */
  private async memberFilter(tx: Tx, ctx: AuthedContext, member: string) {
    const scope = await eventScope(tx, ctx);
    const target = member === "mine" ? ctx.membershipId : member === "all" ? null : member;
    if (target && scope.memberIds && !scope.memberIds.includes(target)) throw forbidden("Not your calendar");
    const events = target ? and(scope.where, { $or: [{ ownerId: target }, { attendeeIds: target }] }) : scope.where;
    const tasks = target ? and((await taskScope(tx, ctx)).where, { assigneeId: target }) : (await taskScope(tx, ctx)).where;
    return { events, tasks };
  }

  async feed(query: CalendarQuery): Promise<CalendarFeedDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const who = await this.memberFilter(tx, ctx, query.member);
      const [rows, tasks] = await Promise.all([
        tx.calendarEvent.find(
          and(who.events, { tenantId: ctx.tenantId }, { $or: [{ recurrence: null, startAt: { $lt: query.to }, endAt: { $gt: query.from } }, { recurrence: { $ne: null }, startAt: { $lt: query.to } }] }),
          { sort: { startAt: 1 }, limit: 2000 },
        ),
        tx.task.find(and(who.tasks, { tenantId: ctx.tenantId, status: { $ne: "CANCELED" }, dueAt: { $gte: query.from, $lt: query.to } }), { sort: { dueAt: 1 }, limit: 1000 }),
      ]);
      const expanded = rows.flatMap((ev) => occurrences(ev, query.from, query.to).map((start) => ({ ev, start })));
      expanded.sort((a, b) => a.start.getTime() - b.start.getTime());
      return { events: await this.toDtos(tx, ctx, expanded), tasks: await this.taskDtos(tx, ctx.tenantId, tasks) };
    });
  }

  async get(id: string): Promise<CalendarEventDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const ev = await this.visible(tx, ctx, id);
      return (await this.toDtos(tx, ctx, [{ ev, start: ev.startAt }]))[0]!;
    });
  }

  /** Recent and upcoming events of a contact (its card), newest first. */
  async forContact(contactId: string): Promise<CalendarEventDto[]> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      await this.contactVisible(tx, ctx, contactId);
      const rows = await tx.calendarEvent.find({ tenantId: ctx.tenantId, contactId }, { sort: { startAt: -1 }, limit: 30 });
      return this.toDtos(tx, ctx, rows.map((ev) => ({ ev, start: ev.startAt })));
    });
  }

  async create(input: EventCreateInput): Promise<CalendarEventDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const ownerId = await this.checkOwner(tx, ctx, input.ownerId);
      const attendeeIds = await this.activeMembers(tx, ctx.tenantId, input.attendeeIds.filter((id) => id !== ownerId));
      await this.checkLinks(tx, ctx, input.contactId, input.dealId);
      const base = {
        tenantId: ctx.tenantId,
        title: input.title,
        kind: input.kind,
        startAt: input.startAt,
        endAt: input.endAt,
        allDay: input.allDay,
        location: input.location ?? null,
        description: input.description ?? null,
        contactId: input.contactId ?? null,
        dealId: input.dealId ?? null,
        ownerId,
        attendeeIds,
        recurrence: input.recurrence ?? null,
        reminderMinutes: input.reminderMinutes ?? null,
        createdById: ctx.membershipId,
      };
      const ev = await tx.calendarEvent.insertOne({ ...base, remindAt: nextRemindAt(base, new Date(Date.now() - 1)) });
      await this.notifications.notify(tx, ctx.tenantId, [ownerId, ...attendeeIds], "event_invited", this.notice(ev), ctx.membershipId);
      return (await this.toDtos(tx, ctx, [{ ev, start: ev.startAt }]))[0]!;
    });
  }

  async update(id: string, input: EventUpdateInput): Promise<CalendarEventDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const ev = await this.editable(tx, ctx, id);
      const ownerId = input.ownerId !== undefined ? await this.checkOwner(tx, ctx, input.ownerId) : ev.ownerId;
      const attendeeIds = input.attendeeIds ? await this.activeMembers(tx, ctx.tenantId, input.attendeeIds.filter((m) => m !== ownerId)) : ev.attendeeIds;
      if (input.contactId !== undefined || input.dealId !== undefined) await this.checkLinks(tx, ctx, input.contactId, input.dealId);
      const next = {
        ...ev,
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        ownerId,
        attendeeIds,
      } as CalendarEvent;
      if (next.endAt < next.startAt) throw new AppError("VALIDATION_FAILED", "The end is before the start");
      const { id: _id, tenantId: _t, createdAt: _c, updatedAt: _u, ...rest } = next;
      const updated = await tx.calendarEvent.update({ id }, { $set: { ...rest, remindAt: nextRemindAt(next, new Date(Date.now() - 1)) } });
      // Newly invited people hear about it
      const added = [ownerId, ...attendeeIds].filter((m) => m !== ev.ownerId && !ev.attendeeIds.includes(m));
      await this.notifications.notify(tx, ctx.tenantId, added, "event_invited", this.notice(updated), ctx.membershipId);
      return (await this.toDtos(tx, ctx, [{ ev: updated, start: updated.startAt }]))[0]!;
    });
  }

  async remove(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      await this.editable(tx, ctx, id);
      await tx.calendarEvent.deleteMany({ id, tenantId: ctx.tenantId });
    });
  }

  /** How a meeting or call went; lands on the contact's timeline. */
  async setOutcome(id: string, outcome: EventOutcome, note: string | null | undefined): Promise<CalendarEventDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const ev = await this.editable(tx, ctx, id);
      const updated = await tx.calendarEvent.update({ id }, { $set: { outcome, outcomeNote: note ?? null, remindAt: null } });
      if (ev.contactId || ev.dealId) {
        await this.activity.record(tx, {
          type: ev.kind === "call" ? "call_logged" : "meeting_done",
          contactId: ev.contactId,
          dealId: ev.dealId,
          payload: { eventId: ev.id, title: ev.title, outcome, note: note ?? null },
        });
      }
      return (await this.toDtos(tx, ctx, [{ ev: updated, start: updated.startAt }]))[0]!;
    });
  }

  /** A call that already happened, logged from the contact card (the call log). */
  async logCall(contactId: string, input: CallLogInput): Promise<CalendarEventDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const contact = await this.contactVisible(tx, ctx, contactId);
      await this.checkLinks(tx, ctx, null, input.dealId);
      const endAt = new Date();
      const ev = await tx.calendarEvent.insertOne({
        tenantId: ctx.tenantId,
        title: contact.name,
        kind: "call",
        startAt: new Date(endAt.getTime() - input.durationMin * 60_000),
        endAt,
        contactId,
        dealId: input.dealId ?? null,
        ownerId: ctx.membershipId,
        outcome: input.outcome,
        outcomeNote: input.note ?? null,
        direction: input.direction,
        createdById: ctx.membershipId,
      });
      await this.activity.record(tx, {
        type: "call_logged",
        contactId,
        dealId: input.dealId ?? null,
        payload: { eventId: ev.id, outcome: input.outcome, direction: input.direction, durationMin: input.durationMin, note: input.note ?? null },
      });
      return (await this.toDtos(tx, ctx, [{ ev, start: ev.startAt }]))[0]!;
    });
  }

  /** Everything needing the caller today (company time zone). */
  async today(): Promise<TodayDto> {
    const ctx = authedContext();
    return this.db.read(async (tx) => {
      const tenant = await tx.tenant.get({ id: ctx.tenantId });
      const now = new Date();
      const from = startOfDay(now, tenant.timezone);
      const to = addDays(from, 1, tenant.timezone);
      const me = ctx.membershipId;
      const mineEv: Filter = { tenantId: ctx.tenantId, $or: [{ ownerId: me }, { attendeeIds: me }] };
      const slaMs = (tenant.inboxSettings ?? DEFAULT_INBOX_SETTINGS).slaMinutes * 60_000;
      const [events, overdue, todays, convs, deals, callbacks, cases] = await Promise.all([
        tx.calendarEvent.find(and(mineEv, { $or: [{ recurrence: null, startAt: { $lt: to }, endAt: { $gt: from } }, { recurrence: { $ne: null }, startAt: { $lt: to } }] }), { limit: 500 }),
        tx.task.find({ tenantId: ctx.tenantId, assigneeId: me, ...OPEN_TASK, dueAt: { $lt: from, $ne: null } }, { sort: { dueAt: 1 }, limit: 50 }),
        tx.task.find({ tenantId: ctx.tenantId, assigneeId: me, status: { $ne: "CANCELED" }, dueAt: { $gte: from, $lt: to } }, { sort: { dueAt: 1 }, limit: 100 }),
        tx.conversation.find({ tenantId: ctx.tenantId, assigneeId: me, status: { $ne: "RESOLVED" }, awaitingSince: { $ne: null } }, { sort: { awaitingSince: 1 }, limit: 30 }),
        tx.deal.find({ tenantId: ctx.tenantId, ownerId: me, closedAt: null, expectedClose: { $ne: null, $lt: addDays(to, 7, tenant.timezone) } }, { sort: { expectedClose: 1 }, limit: 30 }),
        tx.calendarEvent.find({ tenantId: ctx.tenantId, ownerId: me, outcome: "callback" }, { sort: { startAt: -1 }, limit: 20 }),
        tx.serviceCase.find({ tenantId: ctx.tenantId, assigneeId: me, status: { $in: ["open", "in_progress", "waiting"] } }, { sort: { dueAt: 1 }, limit: 20 }),
      ]);
      const channels = new Map((await tx.channel.find({ tenantId: ctx.tenantId, id: { $in: [...new Set(convs.map((c) => c.channelId))] } }, { projection: { id: 1, type: 1 } })).map((c) => [c.id, c.type]));
      const expanded = events.flatMap((ev) => occurrences(ev, from, to).map((start) => ({ ev, start }))).sort((a, b) => a.start.getTime() - b.start.getTime());
      return {
        date: from.toISOString(),
        events: await this.toDtos(tx, ctx, expanded),
        overdueTasks: await this.taskDtos(tx, ctx.tenantId, overdue),
        todayTasks: await this.taskDtos(tx, ctx.tenantId, todays),
        conversations: convs.map((c) => ({
          id: c.id,
          name: c.displayName ?? c.handle ?? "—",
          channel: channels.get(c.channelId) ?? "",
          waitingSince: c.awaitingSince!.toISOString(),
          slaBreached: now.getTime() - c.awaitingSince!.getTime() > slaMs,
        })),
        deals: deals.map((d) => ({ id: d.id, title: d.title, amount: d.amount, currency: d.currency, expectedClose: d.expectedClose?.toISOString() ?? null })),
        callbacks: await this.toDtos(tx, ctx, callbacks.map((ev) => ({ ev, start: ev.startAt }))),
        cases: cases.map((c) => ({ id: c.id, number: c.number, subject: c.subject, dueAt: c.dueAt.toISOString(), overdue: c.dueAt < now })),
      };
    });
  }

  private notice(ev: CalendarEvent) {
    return { eventId: ev.id, title: ev.title, startAt: ev.startAt.toISOString(), kind: ev.kind };
  }

  private async visible(tx: Tx, ctx: AuthedContext, id: string) {
    const ev = await tx.calendarEvent.findOne(and({ id, tenantId: ctx.tenantId }, (await eventScope(tx, ctx)).where));
    if (!ev) throw notFound("Event");
    return ev;
  }

  private canEdit(ctx: AuthedContext, ev: CalendarEvent) {
    return ev.ownerId === ctx.membershipId || ev.createdById === ctx.membershipId || ctx.permissions.includes("tasks.view_all");
  }

  private async editable(tx: Tx, ctx: AuthedContext, id: string) {
    const ev = await this.visible(tx, ctx, id);
    if (!this.canEdit(ctx, ev)) throw forbidden("Only the organiser can change this event");
    return ev;
  }

  /** Someone else as the responsible person needs tasks.assign_any (like task assignment). */
  private async checkOwner(tx: Tx, ctx: AuthedContext, requested: string | null | undefined) {
    const ownerId = requested ?? ctx.membershipId;
    if (ownerId !== ctx.membershipId && !ctx.permissions.includes("tasks.assign_any")) throw forbidden("Cannot plan events for others");
    if (!(await tx.membership.count({ tenantId: ctx.tenantId, id: ownerId, status: "ACTIVE" }))) throw new AppError("VALIDATION_FAILED", "Unknown member");
    return ownerId;
  }

  private async activeMembers(tx: Tx, tenantId: string, ids: string[]) {
    if (!ids.length) return [];
    const found = new Set((await tx.membership.find({ tenantId, id: { $in: ids }, status: "ACTIVE" }, { projection: { id: 1 } })).map((m) => m.id));
    return [...new Set(ids)].filter((id) => found.has(id));
  }

  private async contactVisible(tx: Tx, ctx: AuthedContext, contactId: string) {
    const { where } = await ownerScope(tx, ctx, "contacts.view_all");
    const contact = await tx.contact.findOne(and({ id: contactId, tenantId: ctx.tenantId, deletedAt: null }, where));
    if (!contact) throw notFound("Contact");
    return contact;
  }

  private async checkLinks(tx: Tx, ctx: AuthedContext, contactId: string | null | undefined, dealId: string | null | undefined) {
    if (contactId) await this.contactVisible(tx, ctx, contactId);
    if (dealId) {
      const { where } = await ownerScope(tx, ctx, "contacts.view_all");
      if (!(await tx.deal.count(and({ id: dealId, tenantId: ctx.tenantId }, where)))) throw notFound("Deal");
    }
  }

  private async toDtos(tx: Tx, ctx: AuthedContext, items: { ev: CalendarEvent; start: Date }[]): Promise<CalendarEventDto[]> {
    if (!items.length) return [];
    const evs = items.map((i) => i.ev);
    const [refs, contacts, deals] = await Promise.all([
      memberRefs(tx, ctx.tenantId, evs.flatMap((e) => [e.ownerId, ...e.attendeeIds])),
      tx.contact.find({ tenantId: ctx.tenantId, id: { $in: [...new Set(evs.map((e) => e.contactId).filter((x): x is string => !!x))] } }, { projection: { id: 1, name: 1 } }),
      tx.deal.find({ tenantId: ctx.tenantId, id: { $in: [...new Set(evs.map((e) => e.dealId).filter((x): x is string => !!x))] } }, { projection: { id: 1, title: 1 } }),
    ]);
    const contactBy = new Map(contacts.map((c) => [c.id, c]));
    const dealBy = new Map(deals.map((d) => [d.id, d]));
    const ref = (id: string) => {
      const r = refs.get(id);
      return r ? { id: r.id, name: r.name } : null;
    };
    return items.map(({ ev, start }) => {
      const c = ev.contactId ? contactBy.get(ev.contactId) : undefined;
      const d = ev.dealId ? dealBy.get(ev.dealId) : undefined;
      return {
        id: ev.id,
        title: ev.title,
        kind: ev.kind as CalendarEventDto["kind"],
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + ev.endAt.getTime() - ev.startAt.getTime()).toISOString(),
        allDay: ev.allDay,
        location: ev.location,
        description: ev.description,
        contact: c ? { id: c.id, name: c.name } : null,
        deal: d ? { id: d.id, title: d.title } : null,
        owner: ref(ev.ownerId),
        attendees: ev.attendeeIds.map(ref).filter((r): r is NonNullable<typeof r> => !!r),
        recurrence: ev.recurrence,
        reminderMinutes: ev.reminderMinutes,
        outcome: ev.outcome as EventOutcome | null,
        outcomeNote: ev.outcomeNote,
        direction: ev.direction as CalendarEventDto["direction"],
        canEdit: this.canEdit(ctx, ev),
      };
    });
  }

  private async taskDtos(tx: Tx, tenantId: string, tasks: Task[]): Promise<CalendarTaskDto[]> {
    const refs = await memberRefs(tx, tenantId, tasks.map((t) => t.assigneeId));
    return tasks.map((t) => {
      const a = t.assigneeId ? refs.get(t.assigneeId) : undefined;
      return { id: t.id, title: t.title, dueAt: t.dueAt!.toISOString(), status: t.status, priority: t.priority, assignee: a ? { id: a.id, name: a.name } : null };
    });
  }
}
