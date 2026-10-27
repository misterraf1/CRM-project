const PING_MS = 25_000;
/** Long-lived streams outlive token checks; close periodically so the client reconnects re-authenticated */
const STREAM_MAX_MS = 30 * 60_000;

/**
 * Server-sent events: `subscribe` registers a listener and returns its unsubscribe.
 * Ends when the client goes away (the request is aborted or the body cancelled).
 */
export function eventStream<E>(signal: AbortSignal, subscribe: (send: (event: E) => void) => () => void): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      write(": connected\n\n");
      const unsubscribe = subscribe((event) => write(`data: ${JSON.stringify(event)}\n\n`));
      const ping = setInterval(() => write(": ping\n\n"), PING_MS);
      const limit = setTimeout(() => {
        cleanup();
        controller.close();
      }, STREAM_MAX_MS);
      let done = false;
      cleanup = () => {
        if (done) return;
        done = true;
        unsubscribe();
        clearInterval(ping);
        clearTimeout(limit);
      };
      signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
