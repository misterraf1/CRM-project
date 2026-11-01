import { API_SCOPES, WEBHOOK_EVENTS } from "@/shared";
import { config } from "../config";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ content: { "application/json": { schema } } });
const list = (item: string) => ({ type: "object", properties: { items: { type: "array", items: ref(item) }, total: { type: "integer" }, nextCursor: { type: "string", nullable: true } } });

/** The public API as OpenAPI 3.1 — the paths an API key can reach. */
export function openApi() {
  const server = config().PUBLIC_API_URL ?? config().WEB_ORIGIN;
  const idParam = [{ name: "id", in: "path", required: true, schema: { type: "string" } }];
  const crud = (tag: string, base: string, item: string, create: string, scope: string, listSchema: object = list(item)) => ({
    [base]: {
      get: { tags: [tag], summary: `List (${scope}.read)`, responses: { 200: json(listSchema) } },
      post: { tags: [tag], summary: `Create (${scope}.write)`, requestBody: json(ref(create)), responses: { 201: json(ref(item)) } },
    },
    [`${base}/{id}`]: {
      parameters: idParam,
      get: { tags: [tag], summary: `Get one (${scope}.read)`, responses: { 200: json(ref(item)), 404: { description: "Not found" } } },
      patch: { tags: [tag], summary: `Update (${scope}.write)`, requestBody: json(ref(create)), responses: { 200: json(ref(item)) } },
      delete: { tags: [tag], summary: `Delete (${scope}.write)`, responses: { 200: { description: "Deleted" } } },
    },
  });
  return {
    openapi: "3.1.0",
    info: {
      title: "Axis CRM API",
      version: "1.0",
      description: [
        "Authenticate with an API key from Settings → Integrations: `Authorization: Bearer axk_…`.",
        "A key acts as the member who created it, limited to its scopes. Amounts are in minor units (1 AZN = 100).",
        `Webhooks: POST to your URL with headers X-Axis-Event, X-Axis-Delivery, X-Axis-Timestamp and X-Axis-Signature = "sha256=" + HMAC_SHA256(secret, timestamp + "." + body). Events: ${WEBHOOK_EVENTS.join(", ")}.`,
      ].join("\n\n"),
    },
    servers: [{ url: `${server}/api` }],
    security: [{ apiKey: [] }],
    paths: {
      ...crud("Contacts", "/v1/contacts", "Contact", "ContactInput", "contacts"),
      ...crud("Deals", "/v1/deals", "Deal", "DealInput", "deals"),
      "/v1/pipelines": { get: { tags: ["Deals"], summary: "Pipelines and stages (deals.read)", responses: { 200: { description: "Pipelines" } } } },
      ...crud("Tasks", "/v1/tasks", "Task", "TaskInput", "tasks", { type: "array", items: ref("Task") }),
      ...crud("Products", "/v1/products", "Product", "ProductInput", "products", { type: "array", items: ref("Product") }),
    },
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: `Scopes: ${API_SCOPES.join(", ")}` } },
      schemas: {
        Contact: { type: "object", properties: { id: { type: "string" }, type: { enum: ["person", "company"] }, name: { type: "string" }, email: { type: "string", nullable: true }, phone: { type: "string", nullable: true }, extraPhones: { type: "array", items: { type: "string" } }, stage: { enum: ["LEAD", "QUALIFIED", "CUSTOMER", "CHURNED"] }, source: { type: "string" }, tags: { type: "array", items: { type: "string" } }, customFields: { type: "object" }, createdAt: { type: "string", format: "date-time" } } },
        ContactInput: { type: "object", required: ["name"], properties: { type: { enum: ["person", "company"] }, name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, stage: { type: "string" }, source: { type: "string" }, tags: { type: "array", items: { type: "string" } }, ownerId: { type: "string" }, customFields: { type: "object" } } },
        Deal: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, amount: { type: "integer" }, currency: { type: "string" }, stageId: { type: "string" }, pipelineId: { type: "string" }, expectedClose: { type: "string", nullable: true } } },
        DealInput: { type: "object", required: ["title"], properties: { title: { type: "string" }, amount: { type: "integer" }, currency: { type: "string" }, stageId: { type: "string" }, contactId: { type: "string" }, expectedClose: { type: "string", format: "date" } } },
        Task: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, status: { type: "string" }, priority: { type: "string" }, dueAt: { type: "string", nullable: true } } },
        TaskInput: { type: "object", required: ["title"], properties: { title: { type: "string" }, description: { type: "string" }, dueAt: { type: "string", format: "date-time" }, priority: { enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] }, contactId: { type: "string" }, assigneeId: { type: "string" } } },
        Product: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, sku: { type: "string", nullable: true }, price: { type: "integer" }, currency: { type: "string" }, unit: { type: "string" } } },
        ProductInput: { type: "object", required: ["name", "price"], properties: { name: { type: "string" }, sku: { type: "string" }, price: { type: "integer" }, currency: { type: "string" }, unit: { type: "string" }, taxBp: { type: "integer" } } },
      },
    },
  };
}
