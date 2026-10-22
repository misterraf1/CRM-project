import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { config } from "../config";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";

const EVERY_MS = 5 * 60_000;
const BATCH = 200;

/**
 * Sends one "overdue" notice per task to its assignee and creator.
 * Safe with several API instances: each task is claimed with a conditional update
 * (overdueNotifiedAt IS NULL), so only one instance notifies. Moves to BullMQ with Redis.
 */
@Injectable()
export class OverdueJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("OverdueJob");
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap() {
    if (!config().JOBS_ENABLED) return;
    const tick = () => this.run().catch((e) => this.logger.error(e instanceof Error ? e.stack : String(e)));
    this.timer = setInterval(tick, EVERY_MS);
    void tick();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Returns how many notices were sent (used by tests). */
  async run(): Promise<number> {
    // Cross-tenant by nature: find candidates by id only, then handle each one
    // inside its own tenant-scoped transaction
    const due = await this.prisma.system(() =>
      this.prisma.task.findMany({
        where: { dueAt: { lt: new Date(), not: null }, status: { notIn: ["DONE", "CANCELED"] }, overdueNotifiedAt: null, assigneeId: { not: null } },
        select: { tenantId: true, id: true },
        orderBy: { dueAt: "asc" },
        take: BATCH,
      }),
    );
    let sent = 0;
    for (const { tenantId, id: taskId } of due) {
      sent += await this.prisma.scoped(
        async (tx) => {
          const claimed = await tx.task.updateMany({ where: { id: taskId, tenantId, overdueNotifiedAt: null }, data: { overdueNotifiedAt: new Date() } });
          if (!claimed.count) return 0;
          const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
          await this.notifications.notify(tx, tenantId, [task.assigneeId, task.creatorId], "task_overdue", {
            taskId,
            title: task.title,
            dueAt: task.dueAt?.toISOString() ?? null,
          });
          return 1;
        },
        { tenantId },
      );
    }
    if (sent) this.logger.log(`Sent ${sent} overdue notice(s)`);
    return sent;
  }
}
