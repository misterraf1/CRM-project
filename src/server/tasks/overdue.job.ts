import { Logger } from "../common/logger";
import { AutomationRunner } from "../automations/automation.runner";
import { config } from "../config";
import { JobsMonitor } from "../common/jobs-monitor";
import { NotificationsService } from "../notifications/notifications.service";
import type { Database } from "../db/database";

const EVERY_MS = 5 * 60_000;
const BATCH = 200;

/**
 * Sends one "overdue" notice per task to its assignee and creator.
 * Safe with several API instances: each task is claimed with a conditional update
 * (overdueNotifiedAt IS NULL), so only one instance notifies. Moves to BullMQ with Redis.
 */
export class OverdueJob {
  private readonly logger = new Logger("OverdueJob");
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Database,
    private readonly monitor: JobsMonitor,
    private readonly notifications: NotificationsService,
    private readonly automations: AutomationRunner,
  ) {}

  start() {
    this.monitor.register("overdue-tasks");
    if (!config().JOBS_ENABLED) return;
    const tick = () => this.monitor.track("overdue-tasks", () => this.run());
    this.timer = setInterval(tick, EVERY_MS);
    void tick();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Returns how many notices were sent (used by tests). */
  async run(): Promise<number> {
    // Cross-tenant by nature: find candidates by id only, then handle each one
    // inside its own tenant-scoped transaction
    const due = await this.db.system.task.find(
      { dueAt: { $lt: new Date(), $ne: null }, status: { $nin: ["DONE", "CANCELED"] }, overdueNotifiedAt: null, assigneeId: { $ne: null } },
      { projection: { tenantId: 1, id: 1 }, sort: { dueAt: 1 }, limit: BATCH },
    );
    let sent = 0;
    for (const { tenantId, id: taskId } of due) {
      sent += await this.db.scoped(
        async (tx) => {
          const claimed = await tx.task.updateMany({ id: taskId, tenantId, overdueNotifiedAt: null }, { $set: { overdueNotifiedAt: new Date() } });
          if (!claimed.count) return 0;
          const task = await tx.task.get({ id: taskId });
          await this.notifications.notify(tx, tenantId, [task.assigneeId, task.creatorId], "task_overdue", {
            taskId,
            title: task.title,
            dueAt: task.dueAt?.toISOString() ?? null,
          });
          await this.automations.enqueue(tx, tenantId, "task.overdue", { taskId });
          return 1;
        },
        { tenantId },
      );
    }
    if (sent) this.logger.log(`Sent ${sent} overdue notice(s)`);
    return sent;
  }
}
