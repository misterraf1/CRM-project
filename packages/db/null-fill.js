// MongoDB + Prisma: an optional field left out of a create is not stored at all, and
// Prisma's `{ field: null }` filter does not match a missing field. Every query in
// the API that filters on null (deletedAt, parentId, closedAt, readAt…) would then
// silently match nothing. This middleware writes omitted optional fields as explicit
// nulls (lists as []), including nested creates, so null filters behave like SQL.
// Shared by the API (PrismaService) and the seed script.

const CREATE_ACTIONS = new Set(["create", "createMany", "createManyAndReturn"]);

function createNullFill(dmmf) {
  const models = new Map(dmmf.datamodel.models.map((m) => [m.name, m]));

  function fillNested(model, data) {
    for (const f of model.fields) {
      if (f.kind !== "object") continue;
      const nested = data[f.name];
      if (!nested || typeof nested !== "object") continue;
      if (nested.create) fill(f.type, nested.create);
      if (nested.createMany && nested.createMany.data) fill(f.type, nested.createMany.data);
      if (nested.connectOrCreate) [].concat(nested.connectOrCreate).forEach((c) => fill(f.type, c.create));
      if (nested.upsert) [].concat(nested.upsert).forEach((u) => fill(f.type, u.create));
    }
  }

  function fill(modelName, data) {
    if (Array.isArray(data)) return data.forEach((d) => fill(modelName, d));
    const model = models.get(modelName);
    if (!model || !data || typeof data !== "object") return;
    // Foreign keys set through a relation (tenant: { connect }) must stay absent
    const viaRelation = new Set(model.fields.filter((f) => f.kind === "object" && f.name in data).flatMap((f) => f.relationFromFields || []));
    for (const f of model.fields) {
      if (f.kind === "object" || f.name in data || viaRelation.has(f.name)) continue;
      if (f.hasDefaultValue || f.isUpdatedAt) continue;
      if (f.isList) data[f.name] = [];
      else if (!f.isRequired) data[f.name] = null;
    }
    fillNested(model, data);
  }

  return async (params, next) => {
    const args = params.args;
    if (params.model && args) {
      if (CREATE_ACTIONS.has(params.action)) fill(params.model, args.data);
      else if (params.action === "upsert") {
        fill(params.model, args.create);
        if (args.update) fillNested(models.get(params.model), args.update);
      } else if ((params.action === "update" || params.action === "updateMany") && args.data) {
        fillNested(models.get(params.model), args.data);
      }
    }
    return next(params);
  };
}

module.exports = { createNullFill };
