import { after } from "next/server";

/**
 * Runs `task` once the current response has been sent (so the request's transaction has
 * committed). Inside a Next.js request this is `after()`, which keeps a serverless
 * function alive until the task finishes — a plain timer would be frozen with the
 * function and the work would wait for the next cron run. Outside a request (timers,
 * the tests' HTTP server) it falls back to a short timer.
 */
export function afterResponse(task: () => Promise<unknown>) {
  try {
    after(task);
    return;
  } catch {
    // Not inside a Next.js request scope
  }
  setTimeout(() => void task(), 250).unref();
}

/** Keeps a serverless function alive until `work` settles (no-op outside a Next.js request). */
export function keepAlive(work: Promise<unknown>) {
  try {
    after(() => work);
  } catch {
    // Not inside a Next.js request scope: nothing to keep alive
  }
}
