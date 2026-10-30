import {
  currencySettingsSchema,
  fieldCreateSchema,
  fieldListQuerySchema,
  fieldReorderSchema,
  fieldUpdateSchema,
  pipelineCreateSchema,
  pipelineUpdateSchema,
  stagesReplaceSchema,
} from "@/shared";
import type { Services } from "../container";
import type { Router } from "../http/router";

// CRM configuration. Everyone reads it (forms render the fields, deals offer the
// currencies); changing it takes "crm.configure" (owners and admins by default).
export function crmSettingsRoutes(router: Router, s: Services) {
  router.group("/v1", {}, (r) => {
    r.get("fields", { query: fieldListQuerySchema }, ({ query }) => s.crmSettings.fields(query.entity, query.archived === "true"));

    r.post("fields", { permission: "crm.configure", body: fieldCreateSchema }, ({ body }) => s.crmSettings.createField(body));

    // Declared before :id so "reorder" isn't captured as an id
    r.post("fields/reorder", { permission: "crm.configure", status: 200, body: fieldReorderSchema }, ({ body }) => s.crmSettings.reorderFields(body.entity, body.ids));

    r.patch("fields/:id", { permission: "crm.configure", body: fieldUpdateSchema }, ({ params, body }) => s.crmSettings.updateField(params.id!, body));

    r.get("settings/currencies", () => s.crmSettings.currencies());

    r.patch("settings/currencies", { permission: "crm.configure", body: currencySettingsSchema }, ({ body }) => s.crmSettings.updateCurrencies(body));
  });

  // Pipelines belong to the sales module (PRO and up), like the board itself
  router.group("/v1/pipelines", { feature: "deals.pipeline", permission: "crm.configure" }, (r) => {
    r.post("", { body: pipelineCreateSchema }, ({ body }) => s.crmSettings.createPipeline(body.name));

    r.patch(":id", { body: pipelineUpdateSchema }, ({ params, body }) => s.crmSettings.updatePipeline(params.id!, body));

    r.delete(":id", { status: 204 }, ({ params }) => s.crmSettings.removePipeline(params.id!));

    r.patch(":id/stages", { body: stagesReplaceSchema }, ({ params, body }) => s.crmSettings.replaceStages(params.id!, body.stages));
  });
}
