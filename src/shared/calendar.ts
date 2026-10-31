import { z } from "zod";
import type { MemberRefDto } from "./crm-types";
import { RECURRENCE } from "./task-schemas";

// Calendar: meetings, calls and other events of the team. A call with an outcome is
// also the call log of a contact (who called, how it went, how long).

export const EVENT_KINDS = ["meeting", "call", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const CALL_OUTCOMES = ["done", "no_answer", "busy", "callback", "canceled"] as const;
export type EventOutcome = (typeof CALL_OUTCOMES)[number];

/** Reminder choices offered in the forms (minutes before the start / due time) */
export const REMINDER_MINUTES = [5, 15, 30, 60, 120, 1440] as const;

const id = z.string().min(1).max(64);
const reminder = z.number().int().min(0).max(10_080).nullish();

const eventBase = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(EVENT_KINDS).default("meeting"),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  allDay: z.boolean().default(false),
  location: z.string().trim().max(300).nullish(),
  description: z.string().trim().max(5000).nullish(),
  contactId: id.nullish(),
  dealId: id.nullish(),
  /** Responsible member; defaults to the creator */
  ownerId: id.nullish(),
  attendeeIds: z.array(id).max(50).default([]),
  recurrence: z.string().regex(RECURRENCE, "Unsupported recurrence").nullish(),
  /** Minutes before the start; null = no reminder */
  reminderMinutes: reminder,
});

const endAfterStart = (v: { startAt?: Date; endAt?: Date }) => !v.startAt || !v.endAt || v.endAt >= v.startAt;

export const eventCreateSchema = eventBase.refine(endAfterStart, { message: "The end is before the start", path: ["endAt"] });
export type EventCreateInput = z.infer<typeof eventCreateSchema>;

export const eventUpdateSchema = eventBase
  .partial()
  .refine(endAfterStart, { message: "The end is before the start", path: ["endAt"] })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;

export const eventOutcomeSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  note: z.string().trim().max(2000).nullish(),
});

/** A call that already happened, logged from the contact card */
export const callLogSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  direction: z.enum(["outgoing", "incoming"]).default("outgoing"),
  durationMin: z.number().int().min(0).max(600).default(0),
  note: z.string().trim().max(2000).nullish(),
  dealId: id.nullish(),
});
export type CallLogInput = z.infer<typeof callLogSchema>;

/** At most ~6 weeks: a month view with its leading and trailing days */
export const calendarQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    /** Whose calendar: a member id, "mine" (default) or "all" (within the caller's scope) */
    member: z.string().max(64).default("mine"),
  })
  .refine((v) => v.to > v.from && v.to.getTime() - v.from.getTime() <= 45 * 86_400_000, { message: "Range must be positive and at most 45 days" });

export interface CalendarEventDto {
  id: string;
  title: string;
  kind: EventKind;
  /** This occurrence (recurring events repeat with the same id) */
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  contact: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  owner: MemberRefDto | null;
  attendees: MemberRefDto[];
  recurrence: string | null;
  reminderMinutes: number | null;
  outcome: EventOutcome | null;
  outcomeNote: string | null;
  /** Calls logged after the fact */
  direction: "outgoing" | "incoming" | null;
  canEdit: boolean;
}

export interface CalendarTaskDto {
  id: string;
  title: string;
  dueAt: string;
  status: string;
  priority: string;
  assignee: MemberRefDto | null;
}

export interface CalendarFeedDto {
  events: CalendarEventDto[];
  /** Task deadlines inside the range (read-only on the calendar) */
  tasks: CalendarTaskDto[];
}

/** "Today": everything needing the caller today, in one request */
export interface TodayDto {
  date: string;
  events: CalendarEventDto[];
  overdueTasks: CalendarTaskDto[];
  todayTasks: CalendarTaskDto[];
  /** My conversations waiting for a reply */
  conversations: { id: string; name: string; channel: string; waitingSince: string; slaBreached: boolean }[];
  /** Deals of mine closing within 7 days or already past the expected close date */
  deals: { id: string; title: string; amount: number; currency: string; expectedClose: string | null }[];
  /** Calls to return (outcome "callback") */
  callbacks: CalendarEventDto[];
  /** My open complaints / service requests, nearest target first */
  cases: { id: string; number: string; subject: string; dueAt: string; overdue: boolean }[];
}
