import type { Database } from "../db/database";
import { NotificationsService } from "../notifications/notifications.service";
import { nextRemindAt } from "./calendar.service";

const BATCH = 200;

/**
 * Event and task reminders whose time has come. Each one is claimed with a conditional
 * update on `remindAt` (the value it was found with), so parallel runs notify once.
 * Recurring events move on to the next occurrence's reminder.
 */
export class Reminders {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date()): Promise<number> {
    let sent = 0;
    const events = await this.db.system.calendarEvent.find({ remindAt: { $lte: now, $ne: null } }, { sort: { remindAt: 1 }, limit: BATCH });
    for (const ev of events) {
      const occurrence = new Date(ev.remindAt!.getTime() + (ev.reminderMinutes ?? 0) * 60_000);
      sent += await this.db.scoped(
        async (tx) => {
          const claimed = await tx.calendarEvent.updateMany({ id: ev.id, remindAt: ev.remindAt }, { $set: { remindAt: nextRemindAt(ev, occurrence) } });
          // Already started long ago (e.g. jobs were down): skip the stale notice
          if (!claimed.count || occurrence.getTime() < now.getTime() - 60 * 60_000) return 0;
          await this.notifications.notify(tx, ev.tenantId, [ev.ownerId, ...ev.attendeeIds], "event_reminder", {
            eventId: ev.id,
            title: ev.title,
            startAt: occurrence.toISOString(),
            kind: ev.kind,
          });
          return 1;
        },
        { tenantId: ev.tenantId },
      );
    }

    const tasks = await this.db.system.task.find({ remindAt: { $lte: now, $ne: null } }, { sort: { remindAt: 1 }, limit: BATCH });
    for (const task of tasks) {
      sent += await this.db.scoped(
        async (tx) => {
          const claimed = await tx.task.updateMany({ id: task.id, remindAt: task.remindAt }, { $set: { remindAt: null } });
          if (!claimed.count || task.status === "DONE" || task.status === "CANCELED") return 0;
          await this.notifications.notify(tx, task.tenantId, [task.assigneeId ?? task.creatorId], "task_reminder", {
            taskId: task.id,
            title: task.title,
            dueAt: task.dueAt?.toISOString() ?? null,
          });
          return 1;
        },
        { tenantId: task.tenantId },
      );
    }
    return sent;
  }
}
