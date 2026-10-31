import type { ActivityDto, CalendarEventDto, CalendarFeedDto, ContactDto, TodayDto } from "@/shared";
import request from "supertest";
import { Reminders } from "@/server/calendar/reminders";
import { addMember, createApp, signup, withRawDb, type TestApp } from "./helpers";

const HOUR = 3_600_000;

describe("Calendar, reminders, call log, Today", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  type Auth = { auth: { authorization: string } };
  const feed = async (who: Auth, from: Date, to: Date, member = "mine") =>
    (await http().get(`/v1/calendar?from=${from.toISOString()}&to=${to.toISOString()}&member=${member}`).set(who.auth).expect(200)).body as CalendarFeedDto;
  const notes = async (who: Auth) => (await http().get("/v1/notifications").set(who.auth)).body.items as { type: string; payload: Record<string, string> }[];
  const event = async (who: Auth, body: object) => (await http().post("/v1/calendar/events").set(who.auth).send(body).expect(201)).body as CalendarEventDto;

  it("events: attendees are told and see them; others don't; only the organiser edits", async () => {
    const owner = await signup(app);
    const a = await addMember(app, owner, "EMPLOYEE");
    const b = await addMember(app, owner, "EMPLOYEE");
    const start = new Date(Date.now() + 24 * HOUR);
    await http().post("/v1/calendar/events").set(a.auth).send({ title: "X", startAt: start, endAt: new Date(start.getTime() - HOUR) }).expect(400);
    const ev = await event(a, { title: "Planlama", kind: "meeting", startAt: start, endAt: new Date(start.getTime() + HOUR), attendeeIds: [b.memberId], location: "Ofis" });
    expect(ev).toMatchObject({ owner: { id: a.memberId }, attendees: [{ id: b.memberId }], canEdit: true });
    expect((await notes(b)).find((n) => n.type === "event_invited")?.payload).toMatchObject({ eventId: ev.id, title: "Planlama" });

    const range = [new Date(Date.now()), new Date(Date.now() + 7 * 24 * HOUR)] as const;
    expect((await feed(b, ...range)).events.map((e) => [e.id, e.canEdit])).toEqual([[ev.id, false]]);
    // The owner (view all) sees it in "everyone", a colleague can't look into another calendar
    expect((await feed(owner, ...range, "all")).events.map((e) => e.id)).toEqual([ev.id]);
    expect((await feed(owner, ...range)).events).toEqual([]);
    await http().get(`/v1/calendar?from=${range[0].toISOString()}&to=${range[1].toISOString()}&member=${a.memberId}`).set(b.auth).expect(403);
    await http().patch(`/v1/calendar/events/${ev.id}`).set(b.auth).send({ title: "Mənim" }).expect(403);
    expect((await http().patch(`/v1/calendar/events/${ev.id}`).set(a.auth).send({ title: "Planlama 2" }).expect(200)).body.title).toBe("Planlama 2");
    await http().get(`/v1/calendar?from=${range[0].toISOString()}&to=${new Date(Date.now() + 90 * 24 * HOUR).toISOString()}`).set(a.auth).expect(400);
    await http().delete(`/v1/calendar/events/${ev.id}`).set(a.auth).expect(204);
    expect((await feed(b, ...range)).events).toEqual([]);
  });

  it("recurring events repeat inside the range; task deadlines show alongside", async () => {
    const owner = await signup(app);
    const start = new Date("2030-03-04T09:00:00Z"); // a Monday
    await event(owner, { title: "Həftəlik iclas", startAt: start, endAt: new Date(start.getTime() + HOUR), recurrence: "FREQ=WEEKLY" });
    await http().post("/v1/tasks").set(owner.auth).send({ title: "Hesabat", dueAt: "2030-03-15T12:00:00Z" }).expect(201);
    const march = await feed(owner, new Date("2030-03-01T00:00:00Z"), new Date("2030-04-01T00:00:00Z"));
    expect(march.events.map((e) => e.startAt.slice(0, 10))).toEqual(["2030-03-04", "2030-03-11", "2030-03-18", "2030-03-25"]);
    expect(march.events.every((e) => e.recurrence === "FREQ=WEEKLY")).toBe(true);
    expect(march.tasks.map((t) => t.title)).toEqual(["Hesabat"]);
    expect((await feed(owner, new Date("2030-02-01T00:00:00Z"), new Date("2030-03-01T00:00:00Z"))).events).toEqual([]);
  });

  it("reminders fire once before events and task deadlines; repeating events move to the next one", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const soon = new Date(Date.now() + 10 * 60_000);
    const once = await event(owner, { title: "Zəng", kind: "call", startAt: soon, endAt: new Date(soon.getTime() + 15 * 60_000), reminderMinutes: 15, attendeeIds: [emp.memberId] });
    const daily = await event(owner, { title: "Gündəlik", startAt: soon, endAt: new Date(soon.getTime() + 15 * 60_000), reminderMinutes: 30, recurrence: "FREQ=DAILY" });
    await event(owner, { title: "Sonra", startAt: new Date(Date.now() + 5 * HOUR), endAt: new Date(Date.now() + 6 * HOUR), reminderMinutes: 60 });
    await http().post("/v1/tasks").set(owner.auth).send({ title: "Müqavilə", assigneeId: emp.memberId, dueAt: new Date(Date.now() + 30 * 60_000), reminderMinutes: 60 }).expect(201);

    const reminders = app.get(Reminders);
    expect(await reminders.run()).toBeGreaterThanOrEqual(3);
    expect(await reminders.run()).toBe(0);
    const empTypes = (await notes(emp)).map((n) => [n.type, n.payload.title]);
    expect(empTypes).toEqual(expect.arrayContaining([["event_reminder", "Zəng"], ["task_reminder", "Müqavilə"]]));
    const ownerReminders = (await notes(owner)).filter((n) => n.type === "event_reminder").map((n) => n.payload.title).sort();
    expect(ownerReminders).toEqual(["Gündəlik", "Zəng"]);

    const rows = await withRawDb((db) => db.calendarEvent.find({ id: { $in: [once.id, daily.id] } }));
    expect(rows.find((r) => r.id === once.id)!.remindAt).toBeNull();
    // Tomorrow's occurrence, 30 minutes early
    expect(rows.find((r) => r.id === daily.id)!.remindAt!.getTime()).toBe(soon.getTime() + 24 * HOUR - 30 * 60_000);
  });

  it("calls logged on the contact card land on its timeline; call-backs and today's work show on Today", async () => {
    const owner = await signup(app);
    const c = (await http().post("/v1/contacts").set(owner.auth).send({ name: "Rəşad Məmmədov", phone: "+994501234567" }).expect(201)).body as ContactDto;
    const call = (await http().post(`/v1/contacts/${c.id}/calls`).set(owner.auth).send({ outcome: "callback", durationMin: 3, note: "Axşam zəng et" }).expect(201)).body as CalendarEventDto;
    expect(call).toMatchObject({ kind: "call", outcome: "callback", direction: "outgoing", contact: { id: c.id } });
    const timeline = (await http().get(`/v1/contacts/${c.id}/activities`).set(owner.auth).expect(200)).body as ActivityDto[];
    expect(timeline.find((a) => a.type === "call_logged")?.payload).toMatchObject({ outcome: "callback", durationMin: 3 });
    expect(((await http().get(`/v1/contacts/${c.id}/events`).set(owner.auth).expect(200)).body as CalendarEventDto[]).map((e) => e.id)).toEqual([call.id]);

    // A meeting marked as held
    const meet = await event(owner, { title: "Təqdimat", startAt: new Date(), endAt: new Date(Date.now() + HOUR), contactId: c.id });
    await http().post(`/v1/calendar/events/${meet.id}/outcome`).set(owner.auth).send({ outcome: "done" }).expect(200);
    expect(((await http().get(`/v1/contacts/${c.id}/activities`).set(owner.auth)).body as ActivityDto[]).some((a) => a.type === "meeting_done")).toBe(true);

    await http().post("/v1/tasks").set(owner.auth).send({ title: "Dünənki", dueAt: new Date(Date.now() - 48 * HOUR) }).expect(201);
    const today = (await http().get("/v1/today").set(owner.auth).expect(200)).body as TodayDto;
    expect(today.callbacks.map((e) => e.id)).toEqual([call.id]);
    expect(today.overdueTasks.map((t) => t.title)).toEqual(["Dünənki"]);
    expect(today.events.map((e) => e.id)).toContain(meet.id);

    // Another company's member can't reach the contact
    const other = await signup(app);
    await http().post(`/v1/contacts/${c.id}/calls`).set(other.auth).send({ outcome: "done" }).expect(404);
  });
});
