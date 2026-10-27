import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ChainAiClient } from "@/server/ai/ai.service";

/** Stand-in for OpenRouter's Messages API: each model answers the way the test says. */
describe("AI model fallback chain", () => {
  let server: Server;
  let base: string;
  const behaviour = new Map<string, number>();
  const calls: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { model } = JSON.parse(body) as { model: string };
        calls.push(model);
        const status = behaviour.get(model) ?? 200;
        res.setHeader("content-type", "application/json");
        if (status !== 200) {
          if (status === 429) res.setHeader("retry-after", "120");
          res.statusCode = status;
          return res.end(JSON.stringify({ type: "error", error: { type: "error", message: `status ${status}` } }));
        }
        res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model, stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: `answer from ${model}` }], usage: { input_tokens: 1, output_tokens: 1 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  beforeEach(() => {
    behaviour.clear();
    calls.length = 0;
  });

  it("busy / unavailable models are skipped; the next one answers", async () => {
    const chain = new ChainAiClient("openrouter", "key", ["a:free", "b:free", "c:free"], base);
    behaviour.set("a:free", 429);
    behaviour.set("b:free", 404);
    expect(await chain.complete("sys", "hi")).toEqual({ text: "answer from c:free", model: "c:free" });
    expect(calls).toEqual(["a:free", "b:free", "c:free"]);

    // Cooling-down models aren't asked again on the next request
    calls.length = 0;
    behaviour.clear();
    expect((await chain.complete("sys", "hi")).model).toBe("c:free");
    expect(calls).toEqual(["c:free"]);
    const status = chain.status();
    expect(status.find((s) => s.model === "a:free")).toMatchObject({ lastError: "rate limited", coolingUntil: expect.any(String) });
    expect(status.find((s) => s.model === "b:free")?.lastError).toBe("unavailable (404)");
  });

  it("when everything fails: a clear error; an invalid key stops at once", async () => {
    const chain = new ChainAiClient("openrouter", "key", ["a:free", "b:free"], base);
    behaviour.set("a:free", 500);
    behaviour.set("b:free", 402);
    await expect(chain.complete("sys", "hi")).rejects.toMatchObject({ code: "AI_UNAVAILABLE", details: { reason: "all_busy", tried: 2 } });

    const bad = new ChainAiClient("openrouter", "key", ["x:free", "y:free"], base);
    behaviour.set("x:free", 401);
    await expect(bad.complete("sys", "hi")).rejects.toMatchObject({ code: "AI_UNAVAILABLE", details: { reason: "auth" } });
    expect(calls.filter((m) => m === "y:free")).toHaveLength(0);
  });
});
