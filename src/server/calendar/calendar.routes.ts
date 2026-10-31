import { calendarQuerySchema, callLogSchema, eventCreateSchema, eventOutcomeSchema, eventUpdateSchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function calendarRoutes(router: Router, s: Services) {
  router.group("/v1", {}, (r) => {
    /** Events (recurrences expanded) and task deadlines in a range */
    r.get("calendar", { query: calendarQuerySchema }, ({ query }) => s.calendar.feed(query));

    r.post("calendar/events", { permission: "tasks.create", body: eventCreateSchema }, ({ body }) => s.calendar.create(body));

    r.get("calendar/events/:id", ({ params }) => s.calendar.get(params.id!));

    r.patch("calendar/events/:id", { body: eventUpdateSchema }, ({ params, body }) => s.calendar.update(params.id!, body));

    r.delete("calendar/events/:id", { status: 204 }, ({ params }) => s.calendar.remove(params.id!));

    r.post("calendar/events/:id/outcome", { status: 200, body: eventOutcomeSchema }, ({ params, body }) => s.calendar.setOutcome(params.id!, body.outcome, body.note));

    /** The "Today" page */
    r.get("today", () => s.calendar.today());

    /** Contact card: meetings and the call log */
    r.get("contacts/:id/events", ({ params }) => s.calendar.forContact(params.id!));

    r.post("contacts/:id/calls", { body: callLogSchema }, ({ params, body }) => s.calendar.logCall(params.id!, body));
  });
}
