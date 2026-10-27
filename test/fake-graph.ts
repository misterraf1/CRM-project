import { createServer, type Server } from "node:http";

export interface GraphCall {
  path: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

/** Stand-in for graph.facebook.com: records calls, answers like the real API. */
export async function startFakeGraph(port = 55990) {
  const calls: GraphCall[] = [];
  let failNext = false;
  const server: Server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      calls.push({ path: req.url ?? "", authorization: req.headers.authorization, body: data ? JSON.parse(data) : {} });
      res.setHeader("content-type", "application/json");
      if (failNext) {
        failNext = false;
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { message: "(#131047) Re-engagement message", code: 131047 } }));
      }
      res.end(
        req.url?.endsWith("/me/messages")
          ? JSON.stringify({ recipient_id: "x", message_id: `m_${calls.length}` })
          : JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: `wamid.${calls.length}` }] }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return {
    calls,
    failNextCall: () => (failNext = true),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
