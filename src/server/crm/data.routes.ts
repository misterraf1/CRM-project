import { EXPORT_FORMATS, IMPORT_ENTITIES, contactExportQuerySchema, dealExportQuerySchema, importRequestSchema } from "@/shared";
import { z } from "zod";
import type { Services } from "../container";
import type { Router } from "../http/router";

const templateQuery = z.object({
  entity: z.enum(IMPORT_ENTITIES),
  lang: z.enum(["az", "en", "ru"]).default("az"),
  format: z.enum(EXPORT_FORMATS).default("xlsx"),
});

// Parsing a 5 MB sheet is real work: a tighter limit than ordinary API calls
const heavy = { limit: 30, ttl: 60_000 };

/** CSV/Excel import and export. Both are separate rights: taking data in or out in bulk. */
export function dataRoutes(router: Router, s: Services) {
  router.group("/v1/imports", { permission: "data.import" }, (r) => {
    r.get("", () => s.imports.history());

    // Declared before :id so "template" isn't captured as an id
    r.get("template", { query: templateQuery }, ({ query }) => s.exports.template(query.entity, query.lang, query.format));

    r.post("preview", { upload: true, body: importRequestSchema, status: 200, throttle: heavy }, ({ file, body }) => s.imports.preview(file, body.options));

    r.post("", { upload: true, body: importRequestSchema, throttle: heavy }, ({ file, body }) => s.imports.run(file, body.options));

    r.get(":id", ({ params }) => s.imports.get(params.id!));
  });

  router.group("/v1/exports", { throttle: heavy }, (r) => {
    r.get("contacts", { permission: "contacts.export", query: contactExportQuerySchema }, ({ query }) => s.exports.contacts(query));

    r.get("deals", { permission: "deals.export", feature: "deals.pipeline", query: dealExportQuerySchema }, ({ query }) => s.exports.deals(query));
  });
}
