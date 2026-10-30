import { Logger } from "../common/logger";
import type { ErrorReporter } from "./error-reporter";
import type { JobHealth } from "@/shared";

/**
 * Last-run bookkeeping for background jobs, shown on the platform System page.
 * Per instance and in memory — enough for one API process; moves to the queue's
 * own metrics with BullMQ.
 */
export class JobsMonitor {
  private readonly logger = new Logger("Jobs");
  private readonly jobs = new Map<string, JobHealth>();

  constructor(private readonly errors?: ErrorReporter) {}

  register(name: string) {
    if (!this.jobs.has(name)) this.jobs.set(name, { name, runs: 0, lastRunAt: null, lastDurationMs: null, lastError: null });
  }

  /** Runs one tick; errors are logged and recorded instead of crashing the timer. */
  async track(name: string, run: () => Promise<unknown>) {
    this.register(name);
    const job = this.jobs.get(name)!;
    const started = Date.now();
    try {
      await run();
      job.lastError = null;
    } catch (e) {
      job.lastError = e instanceof Error ? e.message : String(e);
      this.logger.error(`${name}: ${e instanceof Error ? e.stack : String(e)}`);
      this.errors?.capture("job", e, name);
    } finally {
      job.runs += 1;
      job.lastRunAt = new Date(started).toISOString();
      job.lastDurationMs = Date.now() - started;
    }
  }

  list(): JobHealth[] {
    return [...this.jobs.values()].map((j) => ({ ...j }));
  }
}
