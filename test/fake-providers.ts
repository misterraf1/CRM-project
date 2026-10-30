import { createServer, type IncomingMessage, type Server } from "node:http";

export interface ProviderCall {
  method: string;
  path: string;
  authorization: string | undefined;
  contentType: string;
  /** JSON bodies parsed; multipart kept as text (field names and file names are enough to assert on) */
  body: Record<string, unknown> | string;
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

async function read(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Stand-ins for api.telegram.org and graph.facebook.com that also serve media:
 * Telegram getFile/file download, WhatsApp media upload/lookup/download and templates.
 */
export async function startFakeProviders(port: number) {
  const calls: ProviderCall[] = [];
  const base = `http://127.0.0.1:${port}`;
  let failNext = false;
  const server: Server = createServer(async (req, res) => {
    const raw = await read(req);
    const contentType = req.headers["content-type"] ?? "";
    const path = req.url ?? "";
    calls.push({ method: req.method ?? "", path, authorization: req.headers.authorization, contentType, body: contentType.includes("json") && raw.length ? JSON.parse(raw.toString()) : raw.toString("latin1") });
    const json = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(value));
    };
    if (failNext) {
      failNext = false;
      return path.startsWith("/tg/") ? json(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" }) : json(400, { error: { message: "failed", code: 100 } });
    }
    // ── Telegram: /tg/bot<token>/<method>, /tg/file/bot<token>/<path>
    if (path.startsWith("/tg/file/")) {
      res.setHeader("content-type", "application/octet-stream");
      return res.end(PNG);
    }
    const tg = /^\/tg\/bot([^/]+)\/(\w+)$/.exec(path);
    if (tg) {
      const [, token, method] = tg;
      if (token!.startsWith("000")) return json(401, { ok: false, error_code: 401, description: "Unauthorized" });
      const result =
        method === "getMe" ? { id: 777000111, is_bot: true, first_name: "Axis Bot", username: "axis_test_bot" }
        : method === "getFile" ? { file_id: "f", file_size: PNG.length, file_path: "photos/file_1.jpg" }
        : method === "setWebhook" || method === "deleteWebhook" ? true
        : { message_id: calls.length };
      return json(200, { ok: true, result });
    }
    // ── Graph
    if (path.startsWith("/media-download/")) {
      res.setHeader("content-type", "image/png");
      return res.end(PNG);
    }
    if (req.method === "GET" && /message_templates/.test(path)) {
      return json(200, {
        data: [
          { name: "order_ready", language: "az", status: "APPROVED", components: [{ type: "BODY", text: "Salam {{1}}! {{2}} sifarişiniz hazırdır." }] },
          { name: "draft_one", language: "az", status: "PENDING", components: [{ type: "BODY", text: "x" }] },
        ],
      });
    }
    if (req.method === "GET") return json(200, { url: `${base}/media-download/x`, mime_type: "image/png", file_size: PNG.length });
    if (path.endsWith("/media")) return json(200, { id: `media_${calls.length}` });
    return json(200, { messaging_product: "whatsapp", messages: [{ id: `wamid.${calls.length}` }] });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return {
    calls,
    failNextCall: () => (failNext = true),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
