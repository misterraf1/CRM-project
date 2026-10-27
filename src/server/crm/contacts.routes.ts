import { contactCreateSchema, contactListQuerySchema, contactUpdateSchema, noteSchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

// Every member works with contacts; visibility is narrowed by ownerScope() per role.
export function contactsRoutes(router: Router, s: Services) {
  router.group("/v1/contacts", {}, (r) => {
    r.get("", { query: contactListQuerySchema }, ({ query }) => s.contacts.list(query));

    r.post("", { body: contactCreateSchema }, ({ body }) => s.contacts.create(body));

    r.get(":id", ({ params }) => s.contacts.get(params.id!));

    r.patch(":id", { body: contactUpdateSchema }, ({ params, body }) => s.contacts.update(params.id!, body));

    r.delete(":id", { permission: "contacts.delete", status: 204 }, ({ params }) => s.contacts.remove(params.id!));

    r.get(":id/activities", ({ params }) => s.contacts.activities(params.id!));

    r.post(":id/notes", { body: noteSchema }, ({ params, body }) => s.contacts.addNote(params.id!, body.body));
  });
}
