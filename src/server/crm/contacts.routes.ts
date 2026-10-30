import { contactCreateSchema, contactListQuerySchema, contactUpdateSchema, noteSchema, duplicateQuerySchema, consentSchema } from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

// Every member works with contacts; visibility is narrowed by ownerScope() per role.
export function contactsRoutes(router: Router, s: Services) {
  router.group("/v1/contacts", {}, (r) => {
    r.get("", { query: contactListQuerySchema }, ({ query }) => s.contacts.list(query));

    // Declared before :id so "duplicates" isn't taken for an id
    r.get("duplicates", { query: duplicateQuerySchema }, ({ query }) => s.contacts.duplicates(query));

    r.post("", { permission: "contacts.create", body: contactCreateSchema }, ({ body }) => s.contacts.create(body));

    r.get(":id", ({ params }) => s.contacts.get(params.id!));

    r.patch(":id", { permission: "contacts.edit", body: contactUpdateSchema }, ({ params, body }) => s.contacts.update(params.id!, body));

    r.delete(":id", { permission: "contacts.delete", status: 204 }, ({ params }) => s.contacts.remove(params.id!));

    r.get(":id/activities", ({ params }) => s.contacts.activities(params.id!));

    r.get(":id/files", ({ params }) => s.files.forRecord("contact", params.id!));

    r.post(":id/files", { permission: "contacts.edit", upload: true }, ({ params, file }) => s.files.uploadToRecord("contact", params.id!, file));

    r.patch(":id/consent", { permission: "contacts.edit", status: 204, body: consentSchema }, async ({ params, body }) => {
      await s.contacts.setConsent(params.id!, body.status);
    });

    r.post(":id/notes", { permission: "contacts.edit", body: noteSchema }, ({ params, body }) => s.contacts.addNote(params.id!, body.body));
  });
}
